import mongoose,{Schema} from 'mongoose';
function immutable(schema:Schema){schema.pre('save',function(){if(!this.isNew)throw new Error('IMMUTABLE_FINANCE_RECORD');});schema.pre(['updateOne','updateMany','findOneAndUpdate','replaceOne','deleteOne','deleteMany','findOneAndDelete'],function(){throw new Error('IMMUTABLE_FINANCE_RECORD');});}
export function providerPaymentDate(value:any){if(typeof value!=='string'||!/^\d{14}$/.test(value))return undefined;const d=new Date(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(8,10)}:${value.slice(10,12)}:${value.slice(12,14)}+07:00`);return Number.isFinite(+d)&&new Date(+d+7*3600000).toISOString().replace(/[-:T]/g,'').slice(0,14)===value?d:undefined;}
const payment=new Schema({
 orderId:{type:Schema.Types.ObjectId,required:true,unique:true},ownerId:{type:Schema.Types.ObjectId,required:true},
 provider:{type:String,enum:['VNPAY'],required:true},mode:{type:String,enum:['sandbox','production'],required:true},
 amount:{type:Number,required:true,min:0},currency:{type:String,enum:['VND'],default:'VND'},
 outcome:{type:String,enum:['SUCCESS','FAILED'],required:true},channel:{type:String,enum:['CHECKOUT','SAVED_CARD'],required:true},
 providerTransactionId:String,responseCode:String,transactionStatus:String,bankCode:String,cardType:String,providerPaidAt:Date,
 confirmedAt:{type:Date,required:true},
},{timestamps:{createdAt:true,updatedAt:false},collection:'payment_receipts'});
payment.index({confirmedAt:-1,_id:-1});payment.index({mode:1,outcome:1,confirmedAt:-1});payment.index({ownerId:1,confirmedAt:-1});immutable(payment);
const cash=new Schema({
 orderId:{type:Schema.Types.ObjectId,required:true,unique:true},paymentId:{type:Schema.Types.ObjectId,required:true},ownerId:{type:Schema.Types.ObjectId,required:true},
 kind:{type:String,enum:['PAYMENT_RECEIVED'],required:true},amount:{type:Number,required:true,min:0},currency:{type:String,enum:['VND'],default:'VND'},
 mode:{type:String,enum:['sandbox','production'],required:true},occurredAt:{type:Date,required:true},tier:{type:String,required:true},planName:{type:String,required:true},billingCycle:{type:String,enum:['monthly','yearly'],required:true},
},{timestamps:{createdAt:true,updatedAt:false},collection:'cash_movements'});
cash.index({mode:1,occurredAt:-1,_id:-1});cash.index({ownerId:1,occurredAt:-1});immutable(cash);
export const PaymentReceipt=mongoose.models.PaymentReceipt||mongoose.model('PaymentReceipt',payment);
export const CashMovement=mongoose.models.CashMovement||mongoose.model('CashMovement',cash);

for(const model of [PaymentReceipt,CashMovement])model.bulkWrite=async()=>{throw new Error('IMMUTABLE_FINANCE_RECORD');};
