import {parentPort,workerData} from 'node:worker_threads';
import {access,copyFile,mkdir,rename,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {createWorker,OEM,PSM} from 'tesseract.js';

// Tesseract requires a single language directory. Cache only trusted bundled
// models, published atomically; uploaded images never go to the filesystem.
async function languageDirectory() {
  const directory=join(tmpdir(),'veltrix-support-ocr-best-int-v1');
  await mkdir(directory,{recursive:true});
  await Promise.all(['eng','vie'].map(async code=>{
    const target=join(directory,`${code}.traineddata.gz`);
    try {await access(target);return;} catch {}
    const temporary=join(directory,`${code}-${randomUUID()}.tmp`);
    try {
      await copyFile(join(dirname(require.resolve(`@tesseract.js-data/${code}/package.json`)),'4.0.0_best_int',`${code}.traineddata.gz`),temporary);
      await rename(temporary,target);
    } finally {await rm(temporary,{force:true});}
  }));
  return directory;
}

// Fixed local models: no CDN, URL, file path or language from the user.
async function run() {
  const worker = await createWorker(['eng','vie'],OEM.LSTM_ONLY,{langPath:await languageDirectory(),gzip:true,cacheMethod:'none',logger:()=>{},errorHandler:()=>{}},{load_system_dawg:'0',load_freq_dawg:'0'});
  try {
    const bytes=Buffer.from(workerData.bytes);
    const metadata=await sharp(bytes).metadata();
    const stats=await sharp(bytes).greyscale().stats();
    let image=sharp(bytes).removeAlpha().greyscale();
    if(stats.channels[0].mean<128)image=image.negate({alpha:false});
    const readable=await image.resize({width:Math.min((metadata.width||768)*3,3072),height:Math.min((metadata.height||768)*3,3072),fit:'inside'}).png().toBuffer();
    await worker.setParameters({tessedit_pageseg_mode:PSM.AUTO,preserve_interword_spaces:'1',user_defined_dpi:'300'});
    const result=await worker.recognize(readable,{}, {text:true});
    return {text:result.data.text.slice(0,2800),confidence:Math.round(result.data.confidence)};
  } finally {await worker.terminate();}
}
void run().then(result=>parentPort?.postMessage(result)).catch(()=>parentPort?.postMessage({error:true}));
