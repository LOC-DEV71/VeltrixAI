const fs=require('node:fs'),path=require('node:path');
const {sha256,verify}=require('./provision.cjs');const lock=require('./artifacts.lock.json');
async function verifyBundle(full=true){
 for(const item of lock.files){const file=path.join(__dirname,'artifacts',item.path);if(!fs.existsSync(file)||fs.statSync(file).size!==item.bytes||full&&!await verify(item))throw new Error('AI_ARTIFACT_MISSING_OR_CORRUPT: '+item.path+'; run node services/ai/provision.cjs');}
 const file=path.join(__dirname,'artifacts/manifest.json');if(!fs.existsSync(file))throw new Error('AI_MANIFEST_MISSING');
 const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
 if(manifest.revision!==lock.revision||manifest.runtimeVersion!==lock.runtimeVersion)throw new Error('AI_MANIFEST_REVISION_MISMATCH');
 for(const item of manifest.runtimeChecksums){const file=path.join(__dirname,'artifacts',item.path);if(!fs.existsSync(file)||full&&await sha256(file)!==item.sha256)throw new Error('AI_RUNTIME_CHECKSUM_FAILED');}
 const executable=path.join(__dirname,'artifacts',manifest.executable);
 if(!executable.startsWith(path.join(__dirname,'artifacts')+path.sep))throw new Error('AI_RUNTIME_PATH_INVALID');
 return {manifest,executable};
}
module.exports={verifyBundle};
if(require.main===module)verifyBundle().then(()=>console.log('AI_ARTIFACT_VERIFY_PASS')).catch(e=>{console.error(e.message);process.exitCode=1});
