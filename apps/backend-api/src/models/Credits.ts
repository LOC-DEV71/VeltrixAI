import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IDeviceGrantCounter extends Document {
  deviceId: string;
  grantMonth: string;
  count: number;
}

const DeviceGrantCounterSchema = new Schema<IDeviceGrantCounter>({
  deviceId: { type: String, required: true },
  grantMonth: { type: String, required: true },
  count: { type: Number, default: 0 },
}, { timestamps: true });

DeviceGrantCounterSchema.index({ deviceId: 1, grantMonth: 1 }, { unique: true });

export const DeviceGrantCounter: Model<IDeviceGrantCounter> = mongoose.models.DeviceGrantCounter || mongoose.model('DeviceGrantCounter', DeviceGrantCounterSchema);

export interface IFreeGrant extends Document {
  userId: mongoose.Types.ObjectId;
  deviceId: string;
  grantMonth: string;
}

const FreeGrantSchema = new Schema<IFreeGrant>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  deviceId: { type: String, required: true },
  grantMonth: { type: String, required: true },
}, { timestamps: true });

FreeGrantSchema.index({ userId: 1, grantMonth: 1 }, { unique: true });
FreeGrantSchema.index({ deviceId: 1, grantMonth: 1 });

export const FreeGrant: Model<IFreeGrant> = mongoose.models.FreeGrant || mongoose.model('FreeGrant', FreeGrantSchema);

export interface IWallet extends Document {
  userId: mongoose.Types.ObjectId;
  bucket: 'FREE' | 'PAID';
  available: number;
  reserved: number;
}

const WalletSchema = new Schema<IWallet>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  bucket: { type: String, enum: ['FREE', 'PAID'], required: true },
  available: { type: Number, required: true, default: 0 },
  reserved: { type: Number, required: true, default: 0 },
}, { timestamps: true });

WalletSchema.index({ userId: 1, bucket: 1 }, { unique: true });

export const Wallet: Model<IWallet> = mongoose.models.Wallet || mongoose.model('Wallet', WalletSchema);

export interface ICreditLot extends Document {
  walletId: mongoose.Types.ObjectId;
  amount: number;
  available: number;
  expiresAt: Date;
  grantSnapshot?: any;
  billingOrderId?: mongoose.Types.ObjectId;
  source?: 'ADMIN';
  refundBlocked?: boolean;
}

const CreditLotSchema = new Schema<ICreditLot>({
  walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
  amount: { type: Number, required: true },
  available: { type: Number, required: true },
  expiresAt: { type: Date, required: true },
  grantSnapshot: Schema.Types.Mixed,
  billingOrderId: {type:Schema.Types.ObjectId,ref:'BillingOrder',index:true},
  source: { type: String, enum: ['ADMIN'] },
  refundBlocked: {type:Boolean},
}, { timestamps: true });

export const CreditLot: Model<ICreditLot> = mongoose.models.CreditLot || mongoose.model('CreditLot', CreditLotSchema);

export interface IAllocation {
  lotId: mongoose.Types.ObjectId;
  walletId: mongoose.Types.ObjectId;
  amount: number;
}

export interface ICreditReservation extends Document {
  jobId: mongoose.Types.ObjectId;
  allocations: IAllocation[];
  status: 'HELD' | 'SETTLED' | 'RELEASED';
}

const CreditReservationSchema = new Schema<ICreditReservation>({
  jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, unique: true },
  allocations: [{
    lotId: { type: Schema.Types.ObjectId, ref: 'CreditLot', required: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true },
    amount: { type: Number, required: true },
  }],
  status: { type: String, enum: ['HELD', 'SETTLED', 'RELEASED'], default: 'HELD' },
}, { timestamps: true });

CreditReservationSchema.index({'allocations.lotId':1,status:1});
export const CreditReservation: Model<ICreditReservation> = mongoose.models.CreditReservation || mongoose.model('CreditReservation', CreditReservationSchema);

export interface ICreditLedger extends Document {
  walletId: mongoose.Types.ObjectId;
  transactionType: 'GRANT' | 'RESERVE' | 'SETTLE' | 'RELEASE' | 'EXPIRE' | 'REFUND_HOLD' | 'REFUND_RELEASE';
  deltaAvailable: number;
  deltaReserved: number;
  referenceId: string;
}

const CreditLedgerSchema = new Schema<ICreditLedger>({
  walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true },
  transactionType: { type: String, enum: ['GRANT', 'RESERVE', 'SETTLE', 'RELEASE', 'EXPIRE', 'REFUND_HOLD', 'REFUND_RELEASE'], required: true },
  deltaAvailable: { type: Number, required: true },
  deltaReserved: { type: Number, required: true },
  referenceId: { type: String, required: true },
}, { timestamps: true });

CreditLedgerSchema.index({ referenceId: 1, transactionType: 1, walletId: 1 }, { unique: true });

export const CreditLedger: Model<ICreditLedger> = mongoose.models.CreditLedger || mongoose.model('CreditLedger', CreditLedgerSchema);
