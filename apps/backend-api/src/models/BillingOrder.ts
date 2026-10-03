import mongoose,{Schema} from 'mongoose';
const schema=new Schema({
  ownerId:{type:Schema.Types.ObjectId,required:true,index:true},
  requestKey:{type:String,required:true},
  paymentMethodId:Schema.Types.ObjectId,
  tier:{type:String,required:true},billingCycle:{type:String,enum:['monthly','yearly'],required:true},
  amount:{type:Number,required:true},planSnapshot:{type:Schema.Types.Mixed,required:true},
  status:{type:String,enum:['PENDING','PAID','FAILED'],default:'PENDING'},
  expiresAt:{type:Date,required:true},paidAt:Date,providerTransactionId:String,
  startsAt:Date,endsAt:Date,
  mode:{type:String,enum:['sandbox','production'],required:true},
},{timestamps:true});
schema.index({ownerId:1,requestKey:1},{unique:true});
schema.index({providerTransactionId:1},{unique:true,partialFilterExpression:{providerTransactionId:{$type:'string'}}});
schema.index({ownerId:1,createdAt:-1,_id:-1});
schema.index({ownerId:1,status:1,paidAt:-1,_id:-1});
schema.index({mode:1,status:1,paidAt:-1,_id:-1});
schema.index({mode:1,status:1,updatedAt:-1,_id:-1});
schema.index({createdAt:-1,_id:-1});
export const BillingOrder=mongoose.models.BillingOrder || mongoose.model('BillingOrder',schema);
