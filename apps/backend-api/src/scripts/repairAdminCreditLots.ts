import 'dotenv/config';
import mongoose from 'mongoose';
import { Wallet, CreditLot, CreditLedger, CreditReservation } from '../models/Credits';

// Legacy admin grants were the only PAID wallet writer and omitted lots/ledger.
// Count ALL lots, including expired lots, so expired balances are never revived.
export async function repairAdminCreditLots(apply = false) {
  let repaired=0, total=0, skipped=0;
  for (const candidate of await Wallet.find({bucket:'PAID',available:{$gt:0}})) {
    const session=await mongoose.startSession();
    try { await session.withTransaction(async()=>{
      const wallet=await Wallet.findById(candidate._id).session(session);if(!wallet)return;
      const lots=await CreditLot.find({walletId:wallet._id}).session(session);
      const gap=wallet.available-lots.reduce((n,l)=>n+l.available,0);
      if(gap<=0)return;
      const holds=await CreditReservation.find({status:'HELD','allocations.walletId':wallet._id}).session(session);
      const held=holds.flatMap(r=>r.allocations).filter(a=>a.walletId.equals(wallet._id)).reduce((n,a)=>n+a.amount,0);
      if(!Number.isSafeInteger(gap)||held!==wallet.reserved){skipped++;return;}
      if(apply){
        // A wallet write ensures concurrent reservations/grants trigger transaction retry.
        await Wallet.updateOne({_id:wallet._id},{$inc:{__v:1}},{session});
        const [lot]=await CreditLot.create([{walletId:wallet._id,amount:gap,available:gap,source:'ADMIN',expiresAt:new Date('9999-12-31T00:00:00Z')}],{session});
        await CreditLedger.create([{walletId:wallet._id,transactionType:'GRANT',deltaAvailable:0,deltaReserved:0,referenceId:`repair_admin_lot_${lot._id}`}],{session});
      }
      repaired++;total+=gap;
    });}finally{await session.endSession();}
  }
  return {apply,wallets:repaired,credits:total,skipped};
}
if(require.main===module) (async()=>{try{await mongoose.connect(process.env.MONGODB_URI!);console.log(JSON.stringify(await repairAdminCreditLots(process.argv.includes('--apply'))));}finally{await mongoose.disconnect();}})().catch(()=>{console.error('CREDIT_REPAIR_FAILED');process.exitCode=1;});
