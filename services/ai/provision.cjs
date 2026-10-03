// Explicit provisioning only. Startup and inference never call this module.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const lock = require('./artifacts.lock.json');
const directory = path.join(__dirname, 'artifacts');
async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function verify(item) {
  const file = path.join(directory, item.path);
  if (!fs.existsSync(file) || fs.statSync(file).size !== item.bytes) return false;
  return await sha256(file) === item.sha256;
}
async function run() {
  if (process.platform !== 'win32') throw new Error('AI_RUNTIME_PLATFORM_NOT_PROVISIONED: this lock is Windows x64 CUDA only');
  const free = fs.statfsSync(__dirname);
  const missing = lock.files.filter(item => !fs.existsSync(path.join(directory, item.path)));
  const required = missing.reduce((n,item)=>n+item.bytes,0) + 2 * 1024 ** 3;
  if (free.bavail * free.bsize < required) throw new Error('AI_ARTIFACT_DISK_SPACE_INSUFFICIENT');
  for (const item of lock.files) {
    if (await verify(item)) { console.log('Verified: ' + item.path); continue; }
    const file = path.join(directory, item.path);
    fs.mkdirSync(path.dirname(file), {recursive:true});
    console.log('Downloading: ' + item.path + ' (' + item.bytes + ' bytes)');
    const result = spawnSync('curl.exe', ['--fail','--location','--retry','3','--retry-delay','2','--connect-timeout','30','--continue-at','-','--output',file + '.partial',item.url], {stdio:'inherit', windowsHide:true});
    if (result.status !== 0) throw new Error('AI_ARTIFACT_DOWNLOAD_FAILED: ' + item.path);
    if (fs.statSync(file + '.partial').size !== item.bytes || await sha256(file + '.partial') !== item.sha256) throw new Error('AI_ARTIFACT_CHECKSUM_FAILED: ' + item.path);
    fs.renameSync(file + '.partial', file);
  }
  const runtime = path.join(directory,'runtime');
  fs.mkdirSync(runtime,{recursive:true});
  for (const item of lock.files.filter(item=>item.path.endsWith('.zip'))) {
    const quote = value => "'" + value.replaceAll("'", "''") + "'";
    const result = spawnSync('powershell.exe',['-NoProfile','-Command',`Expand-Archive -LiteralPath ${quote(path.join(directory,item.path))} -DestinationPath ${quote(runtime)} -Force`],{stdio:'inherit',windowsHide:true});
    if (result.status !== 0) throw new Error('AI_RUNTIME_EXTRACT_FAILED');
  }
  const provenance = path.join(directory,'provenance');fs.mkdirSync(provenance,{recursive:true});
  for (const [name,url] of [
    ['MODEL_CARD.md', `https://huggingface.co/${lock.model}/raw/${lock.revision}/README.md`],
    ['LLAMA_LICENSE', `https://raw.githubusercontent.com/ggml-org/llama.cpp/${lock.runtimeVersion}/LICENSE`],
    ['APACHE-2.0.txt','https://www.apache.org/licenses/LICENSE-2.0.txt'],
  ]) {
    const response=await fetch(url);if(!response.ok)throw new Error('AI_LICENSE_DOWNLOAD_FAILED');
    fs.writeFileSync(path.join(provenance,name),await response.text());
  }
  const binaries = [];
  const scan = dir => {for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())scan(full);else binaries.push(full);}};scan(runtime);
  const executable=binaries.find(file=>path.basename(file)==='llama-server.exe');
  if(!executable)throw new Error('AI_RUNTIME_BINARY_MISSING');
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({ ...lock, provisionedAt:new Date().toISOString(),executable:path.relative(directory,executable),runtimeChecksums:await Promise.all(binaries.map(async file=>({path:path.relative(directory,file),sha256:await sha256(file)})))},null,2));
  console.log('AI_PROVISION_PASS: model, matching vision projector, runtime and licenses verified');
}
module.exports={sha256,verify};
if(require.main===module)run().catch(error=>{console.error(error.message);process.exitCode=1});
