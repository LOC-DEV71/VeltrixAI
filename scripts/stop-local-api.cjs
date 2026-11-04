// Stop only the recorded API supervisor, after checking durable jobs are idle.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),backend=path.join(root,'apps/backend-api');
require(path.join(backend,'node_modules/dotenv')).config({path:path.join(backend,'.env'),quiet:true});
const mongoose=require(path.join(backend,'node_modules/mongoose'));
(async()=>{
 const file=path.join(root,'services/tts/.runtime/api-process.json');
 if(!fs.existsSync(file)){console.log('LOCAL_API_NOT_RECORDED');return;}
 const recorded=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!Number.isSafeInteger(recorded.pid)||recorded.pid<=0)throw Error('API_PROCESS_IDENTITY_MISMATCH');
 const inspected=spawnSync('powershell.exe',['-NoProfile','-Command',`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${recorded.pid}'; if($null -eq $p){exit 2}; $parent=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p.ParentProcessId); if($p.Name -ne 'node.exe' -or $p.CommandLine -notlike '*${path.join(backend,'dist/index.js').replaceAll("'","''")}*' -or $parent.Name -ne 'node.exe' -or $parent.CommandLine -notlike '*scripts/start-local-api.cjs*'){exit 1}; Write-Output $parent.ProcessId`],{encoding:'utf8',windowsHide:true});
 if(inspected.status===2){console.log('LOCAL_API_ALREADY_STOPPED');return;}
 if(inspected.status!==0)throw Error('API_PROCESS_IDENTITY_MISMATCH');
 const supervisorPid=Number(inspected.stdout.trim());if(!Number.isSafeInteger(supervisorPid)||supervisorPid<=0)throw Error('API_PROCESS_IDENTITY_MISMATCH');
 await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:5000});
 const pending=await mongoose.connection.collection('jobs').countDocuments({status:{$in:['QUEUED','PROCESSING']}});
 const adminPending=await mongoose.connection.collection('admin_voice_jobs').countDocuments({status:{$in:['QUEUED','PROCESSING']}});
 const refundSending=await mongoose.connection.collection('billing_refunds').countDocuments({status:'SENDING'});
 const supportActive=await mongoose.connection.collection('support_inference_leases').countDocuments({expiresAt:{$gt:new Date()}});
 if(refundSending)throw Error('API_REFUND_PENDING: API retained; wait for the active VNPay request to finish');
 if(supportActive)throw Error('API_SUPPORT_PENDING: API retained; wait for the active Support reply to finish');
 if(pending||adminPending)throw Error('API_WORK_PENDING: API retained; wait for jobs to finish before switching provider');
 const stopped=spawnSync('taskkill.exe',['/PID',String(supervisorPid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
 if(stopped.status!==0)throw Error('API_STOP_FAILED');
 console.log('LOCAL_API_STOPPED_WITH_NO_PENDING_JOBS');
})().catch(error=>{console.error(/^[A-Z_]+(?::.*)?$/.test(error.message)?error.message:'LOCAL_API_STOP_FAILED');process.exitCode=1;}).finally(()=>mongoose.disconnect());
