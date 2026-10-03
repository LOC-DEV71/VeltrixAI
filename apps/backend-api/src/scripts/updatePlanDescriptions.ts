import dotenv from 'dotenv';
import mongoose from 'mongoose';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {Plan} from '../models/Plan';
import {getPlanSnapshot,savePlan} from '../services/PlanService';
import {defaultPlanDescription} from '../services/PlanPresentation';
export async function updatePlanDescriptions(){let updated=0;for(const plan of await Plan.find({archived:false})){const snapshot=await getPlanSnapshot(plan.tier,undefined,true),description=defaultPlanDescription(plan.tier);if(snapshot.config.overview.description===description)continue;const config=structuredClone(snapshot.config);config.overview.description=description;await savePlan(plan.tier,config,snapshot.revision,null,'Cập nhật mô tả gói cho giao diện Veltrix',true,'UPDATE_DESCRIPTION');updated++;}return updated;}
if(require.main===module){dotenv.config({path:resolve(__dirname,'../../.env'),quiet:true});(async()=>{await mongoose.connect(process.env.MONGODB_URI!);const folder=resolve(__dirname,'../../../../services/tts/.runtime');await mkdir(folder,{recursive:true});const snapshots=await Promise.all((await Plan.find({archived:false})).map(p=>getPlanSnapshot(p.tier,undefined,true)));await writeFile(resolve(folder,'plan-description-before.json'),JSON.stringify(snapshots,null,2),{flag:'wx'}).catch((e:any)=>{if(e.code!=='EEXIST')throw e;});console.log(JSON.stringify({updated:await updatePlanDescriptions()}));})().catch(()=>{console.error('PLAN_DESCRIPTION_UPDATE_FAILED');process.exitCode=1;}).finally(()=>mongoose.disconnect());}
