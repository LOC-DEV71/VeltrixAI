import mongoose,{Schema} from 'mongoose';
const schema=new Schema({ownerId:{type:Schema.Types.ObjectId,required:true},tokenId:{type:Schema.Types.ObjectId,required:true},method:String,endpoint:String,status:Number,durationMs:Number,jobId:String,characters:Number,expiresAt:{type:Date,required:true}}, {timestamps:{createdAt:true,updatedAt:false}});
schema.index({ownerId:1,createdAt:-1,_id:-1});schema.index({createdAt:-1,_id:-1});schema.index({expiresAt:1},{expireAfterSeconds:0});
export const DeveloperRequest=mongoose.models.DeveloperRequest||mongoose.model('DeveloperRequest',schema);
