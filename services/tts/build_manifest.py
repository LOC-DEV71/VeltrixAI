import hashlib
import json
import zipfile
from pathlib import Path
ROOT = Path(__file__).resolve().parent
BUNDLE = ROOT / 'artifacts'
COMMIT = '85344322b7258b4e25479b692e8e3396baf9db34'
SOURCE = f'source/VieNeu-TTS-{COMMIT}'

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''): digest.update(block)
    return digest.hexdigest()

if __name__ == '__main__':
    license_root = BUNDLE / 'licenses'
    license_root.mkdir(exist_ok=True)
    wheel_licenses = {}
    for wheel in (BUNDLE / 'wheelhouse').glob('*.whl'):
        folder = license_root / wheel.stem
        folder.mkdir(exist_ok=True)
        with zipfile.ZipFile(wheel) as archive:
            for name in archive.namelist():
                if not name.endswith('/') and (name.endswith('.dist-info/METADATA') or any(t in name.lower() for t in ['license', 'copying', 'notice'])):
                    dest = folder / name.replace('/', '__')
                    dest.write_bytes(archive.read(name))
                    if name.endswith('.dist-info/METADATA'): wheel_licenses[wheel.name] = dest.relative_to(BUNDLE).as_posix()
    deployment = BUNDLE / 'deployment'
    deployment.mkdir(exist_ok=True)
    for name in ['main.py', 'local_engine.py', 'verify_bundle.py', 'requirements.lock', 'OFFLINE_DEPLOYMENT.md', 'restore.ps1', 'launch.py', 'test_service_offline.py', 'test_clone_offline.py', 'test-firewall.ps1', 'run-firewall-admin.ps1', 'run-clone-firewall-admin.ps1', 'offline_smoke.py', 'download_models.py', 'build_manifest.py']:
        (deployment / name).write_bytes((ROOT / name).read_bytes())
    source_license = SOURCE + '/LICENSE'
    runtime_license = next(p for p in (BUNDLE / 'runtime').rglob('*') if p.is_file() and p.name.upper().startswith('LICENSE')).relative_to(BUNDLE).as_posix()
    records = []
    for directory in ['source', 'runtime', 'models', 'wheelhouse', 'licenses', 'deployment']:
        for path in sorted((BUNDLE / directory).rglob('*')):
            if not path.is_file() or '__pycache__' in path.parts: continue
            relative = path.relative_to(BUNDLE).as_posix()
            role = {'source': 'source', 'runtime': 'runtime', 'models': 'weights', 'wheelhouse': 'dependency_package', 'licenses': 'license', 'deployment': 'source'}[directory]
            license_path = source_license
            if directory == 'runtime': license_path = runtime_license
            if directory == 'wheelhouse': license_path = wheel_licenses[path.name]
            if directory == 'licenses': license_path = relative
            if directory == 'models':
                if 'codec' in path.parts or 'tokenizer' in path.name: role = 'tokenizer_codec'
                elif path.suffix == '.json': role = 'config'
            if path.name == 'requirements.lock': role = 'dependency_lock'
            records.append({'path': relative, 'role': role, 'sha256': sha(path), 'origin': directory + '; source commit/model-downloads.json/requirements.lock', 'license_path': license_path})
    (BUNDLE / 'manifest.json').write_text(json.dumps({'source': {'commit': COMMIT, 'package': 'vieneu', 'version': '3.8.3'}, 'target_platform': 'windows-amd64-cpu-onnx', 'python_version': '3.12.10', 'artifacts': records}, indent=2), encoding='utf-8')
    print(f'Inventoried {len(records)} files; not offline certification.')
