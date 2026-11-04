import mongoose,{Schema} from 'mongoose';
const quote=new Schema({ownerId:{type:Schema.Types.ObjectId,required:true},orderId:{type:Schema.Types.ObjectId,required:true},expiresAt:{type:Date,required:true},checkedAt:{type:Date,required:true}},{timestamps:true,collection:'billing_refund_quotes'});
quote.index({expiresAt:1},{expireAfterSeconds:0});
const request=new Schema({
 ownerId:{immutable:true,type:Schema.Types.ObjectId,required:true},orderId:{immutable:true,type:Schema.Types.ObjectId,required:true,unique:true},requestKey:{immutable:true,type:String,required:true},
 amount:{immutable:true,type:Number,required:true},mode:{immutable:true,type:String,required:true,enum:['production','sandbox']},spentCredits:{immutable:true,type:Number,required:true},
 status:{type:String,required:true,enum:['PREPARED','SENDING','PROCESSING','UNKNOWN','COMPLETED','REJECTED']},
 providerRequestId:{immutable:true,type:String,required:true,unique:true},providerRequestedAt:{immutable:true,type:Date,required:true},lastCheckedAt:Date,
 responseCode:String,transactionStatus:String,providerRefundId:String,completedAt:Date,
 quoteId:{type:Schema.Types.ObjectId,required:true,immutable:true},confirmedAt:{type:Date,required:true,immutable:true},
 policyVersion:{type:String,required:true,immutable:true},confirmationIpHash:{type:String,required:true,immutable:true},
 paymentReceiptId:{type:Schema.Types.ObjectId,required:true,immutable:true},cashMovementId:{type:Schema.Types.ObjectId,required:true,immutable:true},
 grantLedgerId:{type:Schema.Types.ObjectId,required:true,immutable:true},paymentVerifiedAt:{type:Date,required:true,immutable:true},
 wasSelected:{type:Boolean,required:true,immutable:true},
 frozenLots:[{lotId:{type:Schema.Types.ObjectId,required:true},walletId:{type:Schema.Types.ObjectId,required:true},available:{type:Number,required:true}}],
},{timestamps:true,collection:'billing_refunds'});
request.index({ownerId:1,createdAt:-1});request.index({status:1,lastCheckedAt:1});request.index({ownerId:1,requestKey:1},{unique:true});
const receipt=new Schema({
 refundId:{type:Schema.Types.ObjectId,required:true,unique:true},orderId:{type:Schema.Types.ObjectId,required:true,unique:true},ownerId:{type:Schema.Types.ObjectId,required:true},
 amount:{type:Number,required:true},mode:{type:String,required:true},providerRefundId:{type:String,required:true},occurredAt:{type:Date,required:true},tier:String,planName:String,billingCycle:String,
},{timestamps:{createdAt:true,updatedAt:false},collection:'refund_receipts'});
receipt.index({mode:1,occurredAt:-1});
receipt.pre('save',function(){if(!this.isNew)throw Error('IMMUTABLE_REFUND_RECEIPT');});
receipt.pre(['updateOne','updateMany','findOneAndUpdate','replaceOne','deleteOne','deleteMany','findOneAndDelete'],function(){throw Error('IMMUTABLE_REFUND_RECEIPT');});
const rate=new Schema({key:{type:String,required:true,unique:true},count:{type:Number,required:true},expiresAt:{type:Date,required:true}},{collection:'refund_rates'});
rate.index({expiresAt:1},{expireAfterSeconds:0});
const maintenanceLease=new Schema({key:{type:String,required:true,unique:true},token:{type:String,required:true},expiresAt:{type:Date,required:true}},{collection:'refund_maintenance_leases'});
const audit=new Schema({refundId:{type:Schema.Types.ObjectId,required:true},ownerId:{type:Schema.Types.ObjectId,required:true},orderId:{type:Schema.Types.ObjectId,required:true},status:{type:String,required:true},responseId:String,responseCode:String,transactionStatus:String,reason:String},{timestamps:{createdAt:true,updatedAt:false},collection:'refund_audit'});
audit.index({refundId:1,createdAt:-1});
audit.pre('save',function(){if(!this.isNew)throw Error('IMMUTABLE_REFUND_AUDIT');});
audit.pre(['updateOne','updateMany','findOneAndUpdate','replaceOne','deleteOne','deleteMany','findOneAndDelete'],function(){throw Error('IMMUTABLE_REFUND_AUDIT');});
export const BillingRefundQuote=mongoose.models.BillingRefundQuote||mongoose.model('BillingRefundQuote',quote);
export const BillingRefund=mongoose.models.BillingRefund||mongoose.model('BillingRefund',request);
export const RefundReceipt=mongoose.models.RefundReceipt||mongoose.model('RefundReceipt',receipt);
export const RefundRate=mongoose.models.RefundRate||mongoose.model('RefundRate',rate);
export const RefundMaintenanceLease=mongoose.models.RefundMaintenanceLease||mongoose.model('RefundMaintenanceLease',maintenanceLease);
export const RefundAudit=mongoose.models.RefundAudit||mongoose.model('RefundAudit',audit);
RefundAudit.bulkWrite=async()=>{throw Error('IMMUTABLE_REFUND_AUDIT');};
RefundReceipt.bulkWrite=async()=>{throw Error('IMMUTABLE_REFUND_RECEIPT');};
