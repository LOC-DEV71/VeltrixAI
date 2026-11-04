// Local files only. API key is passed via environment, never process arguments.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');const {verifyBundle}=require('./verify.cjs');
const directory=path.join(__dirname,'.runtime'),connectionFile=path.join(directory,'connection.json');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const {manifest,executable}=await verifyBundle();
 if(fs.existsSync(connectionFile)){const saved=JSON.parse(fs.readFileSync(connectionFile,'utf8'));try{process.kill(saved.pid,0);const r=await fetch(saved.url+'/health',{signal:AbortSignal.timeout(1000)});if(r.ok){console.log('LOCAL_AI_ALREADY_RUNNING');return;}}catch{}}
 fs.mkdirSync(directory,{recursive:true});const token=crypto.randomBytes(32).toString('hex');
 const contextTokens=Number(process.env.AI_CONTEXT_TOKENS||8192),port=8091;
 if(![4096,8192,16384].includes(contextTokens))throw new Error('AI_CONTEXT_INVALID');
 const imageMaxTokens=Number(process.env.AI_IMAGE_MAX_TOKENS||1120);
 if(![70,140,280,560,1120].includes(imageMaxTokens))throw new Error('AI_IMAGE_TOKEN_BUDGET_INVALID');
 // Fix both bounds: max alone allows small screenshot text to use only 140 tokens.
 const args=['--model',path.join(__dirname,'artifacts/model/gemma-4-E4B_q4_0-it.gguf'),'--mmproj',path.join(__dirname,'artifacts/model/gemma-4-E4B-it-mmproj.gguf'),'--host','127.0.0.1','--port',String(port),'--alias','veltrix-gemma-e4b','--ctx-size',String(contextTokens),'--parallel','1','--batch-size','128','--ubatch-size','64','--threads','6','--gpu-layers','auto','--fit-target','768','--lazy-mode','on','--cache-type-k','q8_0','--cache-type-v','q8_0','--flash-attn','on','--no-mmproj-offload','--image-min-tokens',String(imageMaxTokens),'--image-max-tokens',String(imageMaxTokens),'--jinja','--reasoning','off','--no-context-shift','--offline','--no-webui'];
 const cleanEnv={...process.env,LLAMA_API_KEY:token};
 // Block inherited downloader flags that could override the local artifact paths.
 for(const key of Object.keys(cleanEnv))if(key.startsWith('LLAMA_ARG_'))delete cleanEnv[key];
 const log=fs.openSync(path.join(directory,'runtime.log'),'w');const startedAt=Date.now();
 let child;
 try{child=spawn(executable,args,{cwd:path.dirname(executable),env:cleanEnv,windowsHide:true,stdio:['ignore',log,log]});}
 catch{fs.closeSync(log);throw new Error('AI_RUNTIME_EXECUTION_BLOCKED: Windows refused to execute the verified llama-server.exe. Check Application Control policy; no policy was changed.');}
 fs.closeSync(log);
 let spawnError;child.once('error',e=>{spawnError=e});
 const state={pid:child.pid,supervisorPid:process.pid,url:`http://127.0.0.1:${port}`,token,model:'veltrix-gemma-e4b',modelRevision:manifest.revision,contextTokens,imageMaxTokens,maxOutputTokens:Math.min(4096,contextTokens/2),args:args.map(arg=>arg.includes(__dirname)?path.relative(__dirname,arg):arg),startedAt:new Date(startedAt).toISOString()};
 fs.writeFileSync(connectionFile,JSON.stringify(state),{mode:0o600});
 if(process.platform==='win32')spawnSync('icacls.exe',[connectionFile,'/inheritance:r','/grant:r',`${process.env.USERDOMAIN}\\${process.env.USERNAME}:(F)`],{windowsHide:true,stdio:'ignore'});
 const stop=()=>{if(child.exitCode===null)child.kill();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 for(let i=0;i<240;i++){
  if(spawnError||child.exitCode!==null)throw new Error('AI_RUNTIME_START_FAILED: inspect services/ai/.runtime/runtime.log');
  try{const r=await fetch(state.url+'/health',{signal:AbortSignal.timeout(1000)});if(r.ok){state.coldStartMs=Date.now()-startedAt;fs.writeFileSync(connectionFile,JSON.stringify(state),{mode:0o600});console.log('LOCAL_AI_READY: '+state.coldStartMs+' ms; loopback authenticated; one inference slot');await new Promise((resolve)=>{child.once('exit',resolve);});return;}}catch{}
  await delay(1000);
 }
 stop();throw new Error('AI_RUNTIME_START_TIMEOUT');
})().catch(e=>{console.error(e.message);process.exitCode=1});
