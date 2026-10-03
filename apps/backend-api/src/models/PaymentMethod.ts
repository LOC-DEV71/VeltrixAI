import mongoose, { Schema } from 'mongoose';

// Full card numbers and CVV never belong in our database or API payloads.
const schema = new Schema({
  ownerId: { type:Schema.Types.ObjectId, ref:'User', required:true, index:true },
  provider: { type:String, required:true },
  mode: {type:String,enum:['sandbox','production']},
  providerCustomerId: { type:String, required:true, select:false },
  providerPaymentMethodId: { type:String, required:true, select:false },
  providerTokenEncrypted: {type:String,select:false},
  brand: { type:String, required:true },
  last4: { type:String, required:true, match:/^\d{4}$/ },
  expiryMonth: { type:Number, min:1, max:12, validate:Number.isInteger },
  expiryYear: { type:Number, min:2000, max:9999, validate:Number.isInteger },
  isDefault: { type:Boolean, default:false },
  status: { type:String, enum:['ACTIVE','REMOVED'], default:'ACTIVE' },
}, {timestamps:true,strict:'throw'});
schema.index({provider:1,providerPaymentMethodId:1},{unique:true});
export const PaymentMethod = mongoose.models.PaymentMethod || mongoose.model('PaymentMethod',schema);
