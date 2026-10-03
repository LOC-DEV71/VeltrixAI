// Real inference only. No mocks, external URLs, downloads or fabricated timings.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const backend=path.resolve(__dirname,'../../apps/backend-api');
const {normalizeAiImage}=require(path.join(backend,'dist/services/AiImageAssets'));
async function run(){
 const configFile=path.join(__dirname,'.runtime/connection.json');
 if(!fs.existsSync(configFile))throw new Error('BLOCKED: start the verified local runtime first');
 const c=JSON.parse(fs.readFileSync(configFile,'utf8'));
 const ready=await fetch(c.url+'/health',{signal:AbortSignal.timeout(3000)});if(!ready.ok)throw new Error('BLOCKED: runtime not ready');
 const index=process.argv.indexOf('--image'),image=index>=0?process.argv[index+1]:undefined;
 const content=[{type:'text',text:image?'Mô tả chính xác nội dung ảnh, các vật thể và chữ nhìn thấy bằng tiếng Việt. Không đoán thông tin không quan sát được.':'Viết một đoạn nội dung tiếng Việt khoảng 60 tiếng cho video về thói quen đọc sách mỗi ngày. Có mở đầu thu hút và lời kêu gọi tự nhiên.'}];
 if(image){if(!image||!fs.existsSync(image))throw new Error('IMAGE_FILE_MISSING');const normalized=await normalizeAiImage(fs.readFileSync(image).toString('base64'));content.push({type:'image_url',image_url:{url:'data:image/png;base64,'+normalized.bytes.toString('base64')}});}
 let peakVramMiB=0,peakSystemUsedMiB=0,peakRuntimeRssMiB=0;
 function sample(){peakSystemUsedMiB=Math.max(peakSystemUsedMiB,(os.totalmem()-os.freemem())/1024**2);try{peakVramMiB=Math.max(peakVramMiB,Number(execFileSync('nvidia-smi',['--query-gpu=memory.used','--format=csv,noheader,nounits'],{windowsHide:true,timeout:3000,encoding:'utf8'}).trim()));}catch{}try{const rss=Number(execFileSync('powershell.exe',['-NoProfile','-Command',`(Get-Process -Id ${Number(c.pid)}).WorkingSet64`],{windowsHide:true,timeout:3000,encoding:'utf8'}).trim());peakRuntimeRssMiB=Math.max(peakRuntimeRssMiB,rss/1024**2);}catch{}}
 sample();const timer=setInterval(sample,2000);const started=performance.now();let firstTokenMs=null,text='',usage=null,timings=null;
 try{
  const response=await fetch(c.url+'/v1/chat/completions',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify({model:c.model,messages:[{role:'system',content:'Bạn viết nội dung tiếng Việt và mô tả ảnh trung thực. Chỉ trả lời yêu cầu.'},{role:'user',content:image?content:content[0].text}],temperature:0.4,max_tokens:512,stream:true,stream_options:{include_usage:true},reasoning_effort:'none'}),signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw new Error('MODEL_HTTP_'+response.status);
  const decoder=new TextDecoder();let pending='';
  for await(const chunk of response.body){pending+=decoder.decode(chunk,{stream:true});let boundary;while((boundary=pending.indexOf('\n'))>=0){const line=pending.slice(0,boundary).trim();pending=pending.slice(boundary+1);if(!line.startsWith('data:')||line==='data: [DONE]')continue;const item=JSON.parse(line.slice(5));const delta=item.choices?.[0]?.delta?.content;if(delta){if(firstTokenMs===null)firstTokenMs=performance.now()-started;text+=delta;}if(item.usage)usage=item.usage;if(item.timings)timings=item.timings;}}
  if(!text.trim())throw new Error('MODEL_EMPTY_OUTPUT');sample();
  const totalMs=performance.now()-started;
  const result={status:'PASS',inference:'REAL_MODEL',kind:image?'one-image':'text',model:c.model,revision:c.modelRevision,coldStartMs:c.coldStartMs,timeToFirstTokenMs:firstTokenMs,totalMs,usage,timings,tokensPerSecond:usage?.completion_tokens&&firstTokenMs!==null?usage.completion_tokens/((totalMs-firstTokenMs)/1000):null,peakVramMiB,peakRuntimeRssMiB,peakSystemUsedMiB,memorySamplingIntervalMs:2000,networkIsolation:process.env.AI_OFFLINE_TEST==='firewall'?'Runtime outbound blocked by test-offline.ps1; backend/web not isolated':'NOT_PROVEN: --offline prevents runtime downloads but is not network isolation',text};
  fs.writeFileSync(path.join(__dirname,'.runtime',image?'smoke-image.json':'smoke-text.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{clearInterval(timer);}
}
run().catch(e=>{console.error(e.message);process.exitCode=1});
