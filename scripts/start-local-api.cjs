// Start the local API with its existing .env and the private running TTS connection.
// No credentials are written to .env or command-line arguments.
const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),backend=path.join(root,'apps/backend-api'),runtime=path.join(root,'services/tts/.runtime');
require(path.join(backend,'node_modules/dotenv')).config({path:path.join(backend,'.env'),quiet:true});
(async()=>{
 const env={...process.env};
 if(process.argv.includes('--local-ai')){env.AI_PROVIDER='local';}
 try{const connection=JSON.parse(await fs.readFile(path.join(runtime,'connection.json'),'utf8'));if((await fetch(connection.url+'/health/ready',{signal:AbortSignal.timeout(3000)})).ok){env.TTS_SERVICE_URL=connection.url;env.TTS_SERVICE_TOKEN=connection.token;}}catch{}
 const child=spawn(process.execPath,[path.join(backend,'dist/index.js')],{cwd:backend,env,windowsHide:true,stdio:'ignore'});
 await fs.mkdir(runtime,{recursive:true});await fs.writeFile(path.join(runtime,'api-process.json'),JSON.stringify({pid:child.pid,startedAt:new Date().toISOString(),aiProvider:env.AI_PROVIDER||'gemini'}));
 child.on('error',()=>{console.error('LOCAL_API_START_FAILED');process.exitCode=1;});child.on('exit',code=>{process.exitCode=code||0;});
 process.on('SIGTERM',()=>child.kill());process.on('SIGINT',()=>child.kill());
})().catch(()=>{console.error('LOCAL_API_START_FAILED');process.exitCode=1;});
