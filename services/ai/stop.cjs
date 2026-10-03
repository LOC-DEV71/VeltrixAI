const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const file=path.join(__dirname,'.runtime/connection.json');
if(!fs.existsSync(file)){console.log('LOCAL_AI_NOT_RUNNING');process.exit(0);}
const c=JSON.parse(fs.readFileSync(file,'utf8'));
const check=spawnSync('powershell.exe',['-NoProfile','-Command',`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(c.pid)}'; if($null -eq $p){exit 2}; if($p.Name -eq 'llama-server.exe' -and $p.ExecutablePath.StartsWith('${path.join(__dirname,'artifacts').replaceAll("'","''")}')){exit 0};exit 1`],{windowsHide:true,stdio:'ignore'});
if(check.status===2){console.log('LOCAL_AI_ALREADY_STOPPED');process.exit(0);}
if(check.status!==0)throw new Error('AI_PROCESS_IDENTITY_MISMATCH');
const result=spawnSync('taskkill.exe',['/PID',String(c.pid),'/F'],{windowsHide:true,stdio:'ignore'});
if(result.status!==0)throw new Error('AI_STOP_FAILED');
console.log('LOCAL_AI_STOPPED');
