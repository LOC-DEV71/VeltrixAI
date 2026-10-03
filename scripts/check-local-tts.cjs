const path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),backend=path.join(root,'apps/backend-api');
require(path.join(backend,'node_modules/dotenv')).config({path:path.join(backend,'.env'),quiet:true});
const mongoose=require(path.join(backend,'node_modules/mongoose'));
(async()=>{
  let connection;
  try{connection=JSON.parse(fs.readFileSync(path.join(root,'services/tts/.runtime/connection.json'),'utf8'));}catch{}
  const configured=process.env.TTS_SERVICE_URL && process.env.TTS_SERVICE_TOKEN;
  console.log(JSON.stringify({configuredService:!!configured,localConnection:!!connection,sameService:configured && connection?process.env.TTS_SERVICE_URL.replace(/\/$/,'')===connection.url.replace(/\/$/,''):null}));
  for(const [kind,url] of [['configured',process.env.TTS_SERVICE_URL],['local',connection?.url]]) {
    if(!url)continue;
    try{const r=await fetch(url.replace(/\/$/,'')+'/health/ready',{signal:AbortSignal.timeout(3000)});console.log(JSON.stringify({service:kind,status:r.status}));}catch{console.log(JSON.stringify({service:kind,status:'UNAVAILABLE'}));}
  }
  if(connection) {for(const [kind,pid] of [['worker',connection.workerPid],['supervisor',connection.supervisorPid]]) {let alive=false;try{process.kill(pid,0);alive=true;}catch{}console.log(JSON.stringify({process:kind,pid,alive}));}}
  await mongoose.connect(process.env.MONGODB_URI);
  const heartbeat=await mongoose.connection.collection('serviceheartbeats').findOne({name:'TTS_WORKER'},{projection:{seenAt:1}});
  console.log(JSON.stringify({workerHeartbeat:heartbeat?.seenAt||null,workerHeartbeatFresh:!!heartbeat&&Date.now()-+heartbeat.seenAt<60000}));
  console.log(JSON.stringify({activeAudioJobs:await mongoose.connection.collection('jobs').countDocuments({type:{$in:['TTS','VOICE_ENROLLMENT']},status:{$in:['QUEUED','PROCESSING']}})}));
  const jobs=await mongoose.connection.collection('jobs').find({type:{$in:['TTS','VOICE_ENROLLMENT']}},{projection:{type:1,status:1,error:1,createdAt:1,updatedAt:1,attempts:1,'payload.pipelineVersion':1,'payload.source':1}}).sort({createdAt:-1}).limit(5).toArray();
  console.log(JSON.stringify({recentJobs:jobs.map(j=>({...j,error:typeof j.error==='string'&&/^[A-Z_]{1,80}$/.test(j.error)?j.error:j.error?'OPAQUE_ERROR':undefined}))}));
  if(process.argv.includes('--cloud')) {
    const {getCloudinaryConfiguration,signCloudinaryParameters}=require(path.join(backend,'dist/providers/CloudinaryAudioProvider'));
    const config=getCloudinaryConfiguration(),asset=await mongoose.connection.collection('media_assets').findOne({}, {sort:{createdAt:-1},projection:{publicId:1}});
    if(asset){const params={public_id:asset.publicId,format:'wav',type:'authenticated',timestamp:Math.floor(Date.now()/1000),expires_at:Math.floor(Date.now()/1000)+60,attachment:'false'};
      const query=new URLSearchParams({...params,api_key:config.key,signature:signCloudinaryParameters(params,config.secret)});
      try {const r=await fetch(`https://api.cloudinary.com/v1_1/${config.cloud}/video/download?${query}`,{redirect:'manual',signal:AbortSignal.timeout(12000)});const location=r.headers.get('location');console.log(JSON.stringify({cloudDownload:{status:r.status,contentType:r.headers.get('content-type'),redirectHost:location?new URL(location).hostname:null}}));await r.body?.cancel();}
      catch(e){console.log(JSON.stringify({cloudDownload:{error:e.name,causeCode:e.cause?.code||null}}));}
    }
  }
  await mongoose.disconnect();
  if(process.argv.includes('--roundtrip')) {
    const {randomUUID,createHash}=require('node:crypto');
    const {CloudinaryAudioProvider,getCloudinaryConfiguration}=require(path.join(backend,'dist/providers/CloudinaryAudioProvider'));
    const config=getCloudinaryConfiguration(),provider=new CloudinaryAudioProvider(config),id='veltrixai/diagnostics/'+randomUUID();
    const audio=Buffer.alloc(32044);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(32000,40);for(let i=44;i<audio.length;i+=2)audio.writeInt16LE(Math.round(Math.sin(i/25)*4000),i);
    try {
      let start=Date.now();await provider.upload(audio,id);console.log(JSON.stringify({fixtureUploadMs:Date.now()-start}));
      start=Date.now();try{const result=await provider.download(id);console.log(JSON.stringify({freshDownloadMs:Date.now()-start,bytes:result.bytes}));}catch(e){console.log(JSON.stringify({freshDownloadMs:Date.now()-start,error:e.code||'DOWNLOAD_FAILED'}));}
      const suffix=id+'.wav',signature=createHash('sha1').update(suffix+config.secret).digest('base64url').slice(0,8);
      start=Date.now();try{const r=await fetch(`https://res.cloudinary.com/${config.cloud}/video/authenticated/s--${signature}--/${suffix}`,{signal:AbortSignal.timeout(15000)});const bytes=r.ok?(await r.arrayBuffer()).byteLength:0;await r.body?.cancel().catch(()=>{});console.log(JSON.stringify({cdnStatus:r.status,cdnDownloadMs:Date.now()-start,bytes}));}catch(e){console.log(JSON.stringify({cdnError:e.name,cdnDownloadMs:Date.now()-start}));}
    }finally{await provider.destroy(id);console.log('DIAGNOSTIC_FIXTURE_REMOVED');}
  }
})().catch(()=>{console.log('DIAGNOSTIC_UNAVAILABLE');process.exitCode=1;mongoose.disconnect();});
