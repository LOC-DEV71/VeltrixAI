import mongoose,{Schema,Document,Model} from 'mongoose';
export interface IAiImageAsset extends Document {ownerId:mongoose.Types.ObjectId;contentId:mongoose.Types.ObjectId;bytes:number;width:number;height:number;sha256:string;createdAt:Date;}
const schema=new Schema<IAiImageAsset>({ownerId:{type:Schema.Types.ObjectId,ref:'User',required:true},contentId:{type:Schema.Types.ObjectId,ref:'Content',required:true},bytes:{type:Number,required:true},width:{type:Number,required:true},height:{type:Number,required:true},sha256:{type:String,required:true}},{timestamps:true,collection:'ai_image_assets'});
schema.index({ownerId:1,contentId:1,createdAt:-1});
export const AiImageAsset:Model<IAiImageAsset>=mongoose.models.AiImageAsset||mongoose.model<IAiImageAsset>('AiImageAsset',schema);
