param([string]$Bundle = "$PSScriptRoot/artifacts", [string]$EnvironmentPath = "$PSScriptRoot/.venv-restored")
$ErrorActionPreference = 'Stop'
$ttsBundleRoot = (Resolve-Path -LiteralPath $Bundle).Path
$ttsBasePython = Join-Path $ttsBundleRoot 'runtime/python/cpython-3.12.10-windows-x86_64-none/python.exe'
if (Test-Path -LiteralPath $EnvironmentPath) { throw 'Use a new environment path for restoration.' }
& $ttsBasePython "$PSScriptRoot/verify_bundle.py" $ttsBundleRoot "$ttsBundleRoot/manifest.json"
if ($LASTEXITCODE -ne 0) { throw 'Artifact verification failed' }
& $ttsBasePython -m venv $EnvironmentPath
if ($LASTEXITCODE -ne 0) { throw 'Environment creation failed' }
$ttsRestorePython = Join-Path $EnvironmentPath 'Scripts/python.exe'
& $ttsRestorePython -m pip install --no-index --find-links "$ttsBundleRoot/wheelhouse" --require-hashes -r "$ttsBundleRoot/deployment/requirements.lock" --quiet
if ($LASTEXITCODE -ne 0) { throw 'Offline installation failed' }
& $ttsRestorePython -m pip check
if ($LASTEXITCODE -ne 0) { throw 'Dependency verification failed' }
Write-Output 'Offline environment restored; inference certification is separate.'
