import mongoose,{Schema} from 'mongoose';
const schema=new Schema({ownerId:{type:Schema.Types.ObjectId,required:true,index:true},sourceId:{type:String,required:true},title:{type:String,required:true},message:{type:String,required:true},orderId:{type:Schema.Types.ObjectId},readAt:Date},{timestamps:true});
schema.index({ownerId:1,sourceId:1},{unique:true});
schema.index({ownerId:1,createdAt:-1,_id:-1});
export const Notification=mongoose.models.Notification||mongoose.model('Notification',schema);
