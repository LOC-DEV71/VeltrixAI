import mongoose,{Schema} from 'mongoose';
const schema=new Schema({name:{type:String,unique:true,required:true},seenAt:{type:Date,required:true}});
export const ServiceHeartbeat=mongoose.models.ServiceHeartbeat||mongoose.model('ServiceHeartbeat',schema);
