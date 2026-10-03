param([string]$ImagePath)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'artifacts/manifest.json') -Raw | ConvertFrom-Json
$executable=[IO.Path]::GetFullPath((Join-Path (Join-Path $PSScriptRoot 'artifacts') $manifest.executable))
if(-not $executable.StartsWith([IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'artifacts'))+[IO.Path]::DirectorySeparatorChar)){throw 'AI_RUNTIME_PATH_INVALID'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if(-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run this script from an administrator PowerShell to add/remove its temporary runtime-only firewall rule.'}
$rule='Veltrix-Gemma-Offline-'+[guid]::NewGuid().ToString('N')
if((Get-Service MpsSvc).Status -ne 'Running' -or (Get-NetFirewallProfile | Where-Object { -not $_.Enabled })){throw 'Firewall profiles must be enabled for an offline inference claim.'}
try {
 # Block only this exact runtime binary to destinations outside IPv4 loopback.
 # Node/backend MongoDB/Cloudinary remain online; this proves offline model inference.
 New-NetFirewallRule -DisplayName $rule -Direction Outbound -Program $executable -Action Block -RemoteAddress @('0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255','::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff') | Out-Null
 & node (Join-Path $PSScriptRoot 'stop.cjs');if($LASTEXITCODE -ne 0){throw 'AI_STOP_FAILED'}
 $runtimeDir=Join-Path $PSScriptRoot '.runtime'
 $supervisor=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList (Join-Path $PSScriptRoot 'start.cjs') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'offline-start.log') -RedirectStandardError (Join-Path $runtimeDir 'offline-start-error.log') -PassThru
 $ready=$false
 for($attempt=0;$attempt -lt 240;$attempt++){
  if($supervisor.HasExited){throw 'AI_OFFLINE_START_FAILED; inspect offline-start-error.log'}
  try{$r=Invoke-WebRequest -Uri 'http://127.0.0.1:8091/health' -TimeoutSec 1 -UseBasicParsing;if($r.StatusCode -eq 200){$ready=$true;break}}catch{}
  Start-Sleep -Seconds 1
 }
 if(-not $ready){throw 'AI_OFFLINE_START_TIMEOUT'}
 $env:AI_OFFLINE_TEST='firewall'
 & node (Join-Path $PSScriptRoot 'smoke.cjs');if($LASTEXITCODE -ne 0){throw 'AI_OFFLINE_TEXT_FAILED'}
 if($ImagePath){& node (Join-Path $PSScriptRoot 'smoke.cjs') --image $ImagePath;if($LASTEXITCODE -ne 0){throw 'AI_OFFLINE_IMAGE_FAILED'}}
 Write-Output 'AI_OFFLINE_RESTART_PASS: runtime outbound blocked; inspect smoke output for measurements.'
}finally{
 Remove-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue
 Remove-Item Env:AI_OFFLINE_TEST -ErrorAction SilentlyContinue
}
