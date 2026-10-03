# Requires Windows Administrator. Temporary rules affect only dedicated TTS Python.
param([string]$PythonPath = "$PSScriptRoot/.venv/Scripts/python.exe", [string]$BundlePath = "$PSScriptRoot/artifacts", [switch]$Clone)
$ErrorActionPreference = 'Stop'
$ttsRoot = $PSScriptRoot
$ttsPrograms = @($PythonPath, "$BundlePath/runtime/python/cpython-3.12.10-windows-x86_64-none/python.exe")
$ttsVenvConfig = Join-Path (Split-Path (Split-Path $PythonPath -Parent) -Parent) 'pyvenv.cfg'
if (Test-Path -LiteralPath $ttsVenvConfig) {
    $ttsHomeLine = Get-Content -LiteralPath $ttsVenvConfig | Where-Object { $_ -match '^home = ' } | Select-Object -First 1
    if ($ttsHomeLine) { $ttsPrograms += Join-Path ($ttsHomeLine.Substring(7)) 'python.exe' }
}
$ttsPrograms = $ttsPrograms | Select-Object -Unique
$env:TTS_BUNDLE_PATH = $BundlePath
$ttsRules = @()
try {
    foreach ($ttsProgram in $ttsPrograms) {
        $ttsResolvedProgram = (Resolve-Path -LiteralPath $ttsProgram).Path
        $ttsRuleName = 'CreatorAI-TTS-Offline-' + [guid]::NewGuid().ToString()
        New-NetFirewallRule -Name $ttsRuleName -DisplayName $ttsRuleName -Direction Outbound -Program $ttsResolvedProgram -Action Block -Profile Any | Out-Null
        $ttsRules += $ttsRuleName
    }
    if ($Clone) { & $ttsPrograms[0] "$ttsRoot/test_clone_offline.py" --firewall }
    else { & $ttsPrograms[0] "$ttsRoot/test_service_offline.py" --firewall }
    if ($LASTEXITCODE -ne 0) { throw 'Offline firewall test failed' }
} finally {
    foreach ($ttsRuleName in $ttsRules) { Remove-NetFirewallRule -Name $ttsRuleName }
}
