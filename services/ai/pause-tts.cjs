// Wait for in-flight work; stop only the repository's recorded local TTS tree.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),backend=path.join(root,'apps/backend-api');
require(path.join(backend,'node_modules/dotenv')).config({path:path.join(backend,'.env'),quiet:true});
const mongoose=require(path.join(backend,'node_modules/mongoose'));
(async()=>{
 const file=path.join(root,'services/tts/.runtime/connection.json');
 if(!fs.existsSync(file)){console.log('TTS_NOT_RUNNING');return;}
 const c=JSON.parse(fs.readFileSync(file,'utf8'));
 const check=spawnSync('powershell.exe',['-NoProfile','-Command',`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(c.supervisorPid)}'; if($p.Name -eq 'node.exe' -and $p.CommandLine -like '*scripts/start-local-tts.cjs*'){exit 0}else{exit 1}`],{windowsHide:true,stdio:'ignore'});
 if(check.status!==0)throw new Error('TTS_PROCESS_IDENTITY_MISMATCH');
 await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:5000});
 let counts;
 for(let i=0;i<60;i++){
   counts={jobs:await mongoose.connection.collection('jobs').countDocuments({type:{$in:['TTS','VOICE_ENROLLMENT']},status:{$in:['QUEUED','PROCESSING']}}),admin:await mongoose.connection.collection('admin_voice_jobs').countDocuments({status:{$in:['QUEUED','PROCESSING']}})};
   if(!counts.jobs&&!counts.admin)break;
   if(i===59)throw new Error('TTS_WORK_PENDING: service retained; wait for current jobs before retry');
   await new Promise(r=>setTimeout(r,1000));
 }
 const runtime=path.join(__dirname,'.runtime');fs.mkdirSync(runtime,{recursive:true});
 fs.writeFileSync(path.join(runtime,'tts-before.json'),JSON.stringify({recordedAt:new Date().toISOString(),wasRunning:true,supervisorPid:c.supervisorPid,workerPid:c.workerPid,pending:counts,resumeCommand:'node scripts/start-local-tts.cjs'},null,2));
 const stopped=spawnSync('taskkill.exe',['/PID',String(c.supervisorPid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
 if(stopped.status!==0)throw new Error('TTS_STOP_FAILED');
 // Connection contains a stale URL now, but no TTS data/artifact is changed.
 console.log('TTS_PAUSED_WITH_NO_PENDING_JOBS');
})().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>mongoose.disconnect());
