$ErrorActionPreference = 'Stop'
$ttsEvidence = Join-Path $PSScriptRoot 'offline-output'
New-Item -ItemType Directory -Path $ttsEvidence -Force | Out-Null
Start-Transcript -Path (Join-Path $ttsEvidence 'firewall-admin.log') -Force
try {
    & "$PSScriptRoot/test-firewall.ps1" -PythonPath "$PSScriptRoot/.venv-from-backup/Scripts/python.exe" -BundlePath 'C:\CreatorAI-Backups\tts-artifacts'
} finally {
    Stop-Transcript
}
