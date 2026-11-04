import {Server as HttpServer} from 'node:http';
import {Server, Socket} from 'socket.io';
import {verifyAccessToken} from '../utils/jwt';
import {Session} from '../models/Session';
import {User} from '../models/User';
import {adminCan} from './AdminAccess';
import {AdminSession} from '../models/AdminSession';
import {AdminAccount} from '../models/AdminAccount';
import '../models/AdminRole';
import {BillingOrder} from '../models/BillingOrder';
import {FreeIpDenial} from '../models/FreeIpPolicy';
import {BillingRefund} from '../models/BillingRefund';

let realtime: Server | undefined;
type OrderEventRecord = {_id: unknown; ownerId: unknown; status: string; amount: number; billingCycle: string;
  mode: string; createdAt: Date; paidAt?: Date; planSnapshot: {config: {overview: {name: string}}}};
function cookie(header: string | undefined, name: string) {
  const value = header?.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
  if (!value) throw new Error('UNAUTHORIZED');
  return decodeURIComponent(value.slice(name.length + 1));
}
async function identity(socket: Socket, admin: boolean, permission = 'billing.read') {
  const payload = verifyAccessToken(cookie(socket.handshake.headers.cookie, admin ? 'adminAccessToken' : 'accessToken'));
  if (admin) {
    const session = await AdminSession.findById(payload.sessionId).lean();
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new Error('UNAUTHORIZED');
    const account = await AdminAccount.findById(session.adminId).populate('roleId');
    if (!account || account.status !== 'ACTIVE' || !adminCan(account,permission)) throw new Error('FORBIDDEN');
    return String(account._id);
  }
  const session = await Session.findById(payload.sessionId).lean();
  if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new Error('UNAUTHORIZED');
  const account = await User.findById(session.userId).select('_id status').lean();
  if (!account || account.status !== 'ACTIVE') throw new Error('UNAUTHORIZED');
  return String(account._id);
}
export function attachBillingRealtime(server: HttpServer, origins: string[]) {
  // Cookie authentication also requires an allowed browser origin, including WebSocket upgrades.
  const allowed = new Set(origins.map(v => v.trim()).filter(Boolean));
  const io = new Server(server, {
    path: '/socket.io', cors: {origin: [...allowed], credentials: true},
    allowRequest: (req, next) => next(null, !!req.headers.origin && allowed.has(req.headers.origin)),
    maxHttpBufferSize: 16 * 1024,
  });
  realtime = io;
  const security = io.of('/admin-security');
  security.use((socket, next) => {identity(socket, true, 'users.read').then(id => {socket.data.accountId = id; next();}).catch(() => next(new Error('FORBIDDEN')));});
  security.on('connection', socket => {
    const timer = setInterval(() => {void identity(socket, true, 'users.read').catch(() => socket.disconnect(true));}, 30000);
    timer.unref(); socket.once('disconnect', () => clearInterval(timer));
  });
  for (const admin of [false, true]) {
    const namespace = io.of(admin ? '/admin-billing' : '/billing');
    namespace.use((socket, next) => {
      identity(socket, admin).then(id => {socket.data.accountId = id; next();})
        .catch(() => next(new Error('Phiên đăng nhập không hợp lệ hoặc không có quyền truy cập.')));
    });
    namespace.on('connection', socket => {
      void socket.join(admin ? 'finance' : `owner:${socket.data.accountId}`);
      const timer = setInterval(() => {void identity(socket, admin).catch(() => socket.disconnect(true));}, 30000);
      timer.unref(); socket.once('disconnect', () => clearInterval(timer));
    });
  }
  io.engine.once('close', () => {if (realtime === io) realtime = undefined;});
  return io;
}

export async function publishFreeIpDenial(id: string) {
  if (!realtime) return;
  const event = await FreeIpDenial.findById(id).lean();
  if (!event) return;
  await Promise.allSettled([...realtime.of('/admin-security').sockets.values()].map(async socket => {
    try {await identity(socket, true, 'users.read'); socket.emit('security:free-ip', {...event, eventId: id});}
    catch {socket.disconnect(true);}
  }));
}

// Call only after the database write/transaction commits. Reconnects recover through HTTP history.
export async function publishBillingOrder(orderId: unknown) {
  const io = realtime;
  if (!io) return;
  const order = await BillingOrder.findById(orderId).select('_id ownerId status amount billingCycle mode createdAt paidAt planSnapshot.config.overview.name').lean<OrderEventRecord>();
  if (!order) return;
  const refund=await BillingRefund.findOne({orderId:order._id}).select('status amount').lean<{status:string;amount:number}>();
  const event = {eventId: `${order._id}:${order.status}:${refund?.status||'none'}`, orderId: String(order._id), status: order.status,refundStatus:refund?.status,
    amount: order.amount, billingCycle: order.billingCycle, mode: order.mode,
    planName: order.planSnapshot.config.overview.name, createdAt: order.createdAt, paidAt: order.paidAt};
  for (const admin of [false, true]) {
    const namespace = io.of(admin ? '/admin-billing' : '/billing');
    const room = admin ? 'finance' : `owner:${order.ownerId}`;
    const sockets = [...namespace.sockets.values()].filter(socket => socket.rooms.has(room));
    await Promise.allSettled(sockets.map(async socket => {
      try {
        const id = await identity(socket, admin);
        if (!admin && id !== String(order.ownerId)) return;
        socket.emit('billing:order', admin ? {...event, ownerId: String(order.ownerId)} : event);
      } catch {socket.disconnect(true);}
    }));
  }
}
