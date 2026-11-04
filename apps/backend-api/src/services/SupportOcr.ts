import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
export type SupportOcrResult={status:'ready'|'unavailable';text:string;confidence:number};

export function redactSupportOcr(text:string) {
  // eslint-disable-next-line no-control-regex -- Strip non-printing OCR characters before returning text.
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'')
    .replace(/(Bearer\s+)(?!\$TOKEN\b|YOUR_API_KEY\b)[a-zA-Z0-9_.-]{16,}/gi,'$1[đã ẩn]')
    .replace(/((?:mật khẩu|password|api[_ -]?key|secret|otp)\s*["']?\s*[:=]\s*["']?)[^\s,"';}]+/gi,'$1[đã ẩn]')
    .slice(0,2800).trim();
}
// Invoked only while the shared Support admission lease is held. At most one
// image is decoded/OCR'd per admitted turn, with a bounded lifetime and no cache.
export async function readSupportImageText(bytes:Buffer):Promise<SupportOcrResult> {
  try {
    const result=await new Promise<{text:string;confidence:number}>((resolve,reject)=>{
      const worker=new Worker(join(__dirname,'SupportOcrWorker.js'),{workerData:{bytes},resourceLimits:{maxOldGenerationSizeMb:128},stdout:true,stderr:true});
      // OCR library diagnostics can contain raw input/model bytes. Do not log
      // those or retain them; expose only the bounded typed result.
      worker.stdout?.resume();worker.stderr?.resume();
      const timeout=setTimeout(()=>finish(new Error('OCR_TIMEOUT')),20000);
      let settled=false;
      function finish(error?:Error,data?:{text:string;confidence:number}) {
        if(settled)return;settled=true;clearTimeout(timeout);void worker.terminate().catch(()=>{});
        if(error)reject(error);else resolve(data!);
      }
      worker.once('error',error=>finish(error));
      worker.once('exit',()=>{if(!settled)finish(new Error('OCR_WORKER_EXIT'));});
      worker.once('message',data=>{if(!data||typeof data.text!=='string'||!Number.isFinite(data.confidence))finish(new Error('OCR_FAILED'));else finish(undefined,data);});
    });
    return {status:'ready',text:redactSupportOcr(result.text),confidence:Math.max(0,Math.min(100,result.confidence))};
  } catch {return {status:'unavailable',text:'',confidence:0};}
}
