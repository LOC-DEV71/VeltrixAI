// Real Mongo transactions; temporary owners/wallets only. Never log configuration.
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const { User } = require('../dist/models/User');
const { Wallet, CreditLot, CreditReservation, CreditLedger } = require('../dist/models/Credits');
const { CreditService } = require('../dist/services/CreditService');
const owners = [], wallets = [], jobIds = [];
async function run() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  for (const finalization of ['settle', 'release']) {
    const owner = await User.create({ email: `ag018-expiry-${crypto.randomUUID()}@example.invalid`, displayName: 'Temporary credit test' });
    owners.push(owner._id);
    const wallet = await Wallet.create({ userId: owner._id, bucket: 'FREE', available: 2, reserved: 0 }); wallets.push(wallet._id);
    const lot = await CreditLot.create({ walletId: wallet._id, amount: 2, available: 2, expiresAt: new Date(Date.now() + 60000) });
    const jobId = new mongoose.Types.ObjectId(); jobIds.push(jobId);
    await CreditService.reserve(owner._id, 'FREE', 2, jobId);
    await CreditService.reserve(owner._id, 'FREE', 2, jobId);
    assert.equal(await CreditLedger.countDocuments({ referenceId: `reserve_${jobId}` }), 1);
    await CreditLot.updateOne({ _id: lot._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    for (let replay = 0; replay < 2; replay++) {
      if (finalization === 'settle') await CreditService.settle(jobId, 1);
      else await CreditService.release(jobId);
    }
    const finalWallet = await Wallet.findById(wallet._id);
    assert.equal(finalWallet.available, 0); assert.equal(finalWallet.reserved, 0);
    const ledger = await CreditLedger.find({ walletId: wallet._id });
    assert.equal(ledger.reduce((total, entry) => total + entry.deltaReserved, 0), 0);
    assert.equal(ledger.filter(entry => entry.transactionType === 'EXPIRE').length, 1);
    assert.equal(ledger.filter(entry => entry.transactionType === finalization.toUpperCase()).length, 1);
    assert.equal((await CreditLot.findById(lot._id)).available, 0);
  }
  console.log('CREDIT_EXPIRY_IDEMPOTENCY_PASS');
}
run().catch(() => { console.error('CREDIT_EXPIRY_TEST_FAILED'); process.exitCode = 1; }).finally(async () => {
  if (mongoose.connection.readyState === 1) {
    await CreditReservation.deleteMany({ jobId: { $in: jobIds } });
    await CreditLedger.deleteMany({ walletId: { $in: wallets } });
    await CreditLot.deleteMany({ walletId: { $in: wallets } });
    await Wallet.deleteMany({ _id: { $in: wallets } });
    await User.deleteMany({ _id: { $in: owners } });
  }
  await mongoose.disconnect();
}).catch(() => { console.error('CREDIT_EXPIRY_CLEANUP_FAILED'); process.exitCode = 1; });
