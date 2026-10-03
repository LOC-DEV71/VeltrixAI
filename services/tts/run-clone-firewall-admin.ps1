$ErrorActionPreference = 'Stop'
$ttsEvidence = Join-Path $PSScriptRoot 'offline-output/clone'
New-Item -ItemType Directory -Path $ttsEvidence -Force | Out-Null
Start-Transcript -Path (Join-Path $ttsEvidence 'firewall-admin.log') -Force
try {
    & "$PSScriptRoot/test-firewall.ps1" -Clone
    if ($LASTEXITCODE -ne 0) { throw 'Clone firewall test failed' }
    'PASS' | Set-Content -LiteralPath (Join-Path $ttsEvidence 'firewall-result.txt')
} catch {
    'FAIL' | Set-Content -LiteralPath (Join-Path $ttsEvidence 'firewall-result.txt')
    throw
} finally { Stop-Transcript }
