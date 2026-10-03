import mongoose from 'mongoose';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/index';
import { User } from '../src/models/User';
import { AdminAccount } from '../src/models/AdminAccount';
import { AdminRole } from '../src/models/AdminRole';
import { Session } from '../src/models/Session';
import { AdminSession } from '../src/models/AdminSession';
import { signAccessToken } from '../src/utils/jwt';
import { randomUUID } from 'crypto';

describe('Admin Authentication & RBAC Isolation', () => {
  let clientUser: any, clientToken: string, adminUser: any, adminToken: string;

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/creatorai_test');
    
    await User.deleteMany({});
    await AdminAccount.deleteMany({});
    await AdminRole.deleteMany({});
    await Session.deleteMany({});
    await AdminSession.deleteMany({});

    // Client user
    clientUser = await User.create({ email: 'client@example.com', displayName: 'Client' });
    const clientSession = await Session.create({
      userId: clientUser._id,
      tokenFamily: randomUUID(),
      refreshTokenHash: 'hash',
      expiresAt: new Date(Date.now() + 100000)
    });
    clientToken = signAccessToken({ sessionId: clientSession._id, userId: clientUser._id });

    // Admin Role & User
    const ownerRole = await AdminRole.create({ name: 'OWNER', permissions: ['*'], isSystem: true });
    adminUser = await AdminAccount.create({ email: 'admin@example.com', passwordHash: 'hash', displayName: 'Owner', roleId: ownerRole._id });
    
    const adminSession = await AdminSession.create({
      adminId: adminUser._id,
      tokenFamily: randomUUID(),
      refreshTokenHash: 'hash',
      expiresAt: new Date(Date.now() + 100000)
    });
    adminToken = signAccessToken({ sessionId: adminSession._id });
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('client user cannot access admin routes using client token', async () => {
    // Attempting to use client token as admin token
    const res = await request(app)
      .get('/api/admin/plans/FREE')
      .set('Cookie', [`adminAccessToken=${clientToken}`]);

    expect(res.status).toBe(401);
  });

  it('admin user cannot access client routes using admin token', async () => {
    // Attempting to use admin token as client token
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(401);
  });
  
  it('support admin is forbidden from updating plans', async () => {
    const supportRole = await AdminRole.create({ name: 'SUPPORT', permissions: ['users.read'], isSystem: true });
    const supportAdmin = await AdminAccount.create({ email: 'support@example.com', passwordHash: 'hash', displayName: 'Support', roleId: supportRole._id });
    
    const supportSession = await AdminSession.create({
      adminId: supportAdmin._id,
      tokenFamily: randomUUID(),
      refreshTokenHash: 'hash',
      expiresAt: new Date(Date.now() + 100000)
    });
    const supportToken = signAccessToken({ sessionId: supportSession._id });

    // Mocking the requirePermission middleware directly to bypass CSRF for unit test
    const { requirePermission } = await import('../src/middlewares/adminAuthMiddleware');
    const req = { admin: supportAdmin } as any;
    const res = { status: (code: number) => ({ json: (data: any) => ({ code, data }) }) } as any;
    const next = () => {};

    const middleware = requirePermission('plans.update');
    // Call middleware and catch response
    let responseCode = 200;
    res.status = (code: number) => {
      responseCode = code;
      return res;
    };
    
    // Test
    await middleware(req, res, next);
    expect(responseCode).toBe(403); // Forbidden due to insufficient permissions
  });
});
