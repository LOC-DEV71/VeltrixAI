"""Start/stop the real HTTP service twice, testing WAV output and egress probes.
Use --firewall only while firewall rules for both dedicated Python executables exist.
"""
import json
import hashlib
import array
import secrets
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path
ROOT = Path(__file__).resolve().parent

if '--child' in sys.argv:
    if '--firewall' not in sys.argv:
        def deny_egress(event, args):
            if event == 'socket.connect' and str(args[1][0]) not in ['127.0.0.1', '::1']:
                raise PermissionError('TEST_EGRESS_BLOCKED')
        sys.addaudithook(deny_egress)
    blocked = []
    for url in ['https://github.com', 'https://huggingface.co', 'https://vieneu.io']:
        try:
            urllib.request.urlopen(url, timeout=5)
        except (PermissionError, urllib.error.URLError): blocked.append(url)
    if len(blocked) != 3: raise RuntimeError('Egress probes were not blocked')
    print('EGRESS_PROBES_BLOCKED', flush=True)
    import uvicorn
    uvicorn.run('main:app', host='127.0.0.1', port=8001, workers=1)
else:
    token = secrets.token_hex(32)
    output = ROOT / 'offline-output'
    output.mkdir(exist_ok=True)
    (output / 'service-test.json').unlink(missing_ok=True)
    evidence = []
    for run in [1, 2]:
        log_path = output / f'service-{run}.log'
        with log_path.open('w', encoding='utf-8') as log:
            command = [sys.executable, str(Path(__file__).resolve()), '--child']
            if '--firewall' in sys.argv: command.append('--firewall')
            process = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=log, env={**os.environ, 'PYTHONUTF8': '1', 'TTS_SERVICE_TOKEN': token})
            try:
                ready = False
                for _ in range(120):
                    if process.poll() is not None: raise RuntimeError(f'Service exited; see {log_path.name}')
                    try:
                        with urllib.request.urlopen('http://127.0.0.1:8001/health/ready', timeout=2) as result:
                            ready = json.load(result)['inference_configured']
                        if ready: break
                    except (urllib.error.URLError, TimeoutError): time.sleep(1)
                if not ready: raise RuntimeError('Startup timed out')
                text = 'Xin chào, đây là lần khởi động thứ ' + str(run) + ' của dịch vụ giọng đọc local.'
                request = urllib.request.Request('http://127.0.0.1:8001/synthesize', data=json.dumps({'text': text, 'voice': 'Hải Đăng'}).encode(), headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
                with urllib.request.urlopen(request, timeout=120) as result: wav = result.read()
                audio_path = output / f'service-{run}.wav'
                audio_path.write_bytes(wav)
                with wave.open(str(audio_path)) as audio:
                    assert audio.getframerate() == 48000 and audio.getnframes() > 48000
                    assert audio.getsampwidth() == 2
                    samples = array.array('h', audio.readframes(audio.getnframes()))
                    peak = max(abs(sample) for sample in samples)
                    assert peak > 100, 'Silent or near-silent audio'
                evidence.append({'run': run, 'audio': audio_path.name, 'bytes': len(wav), 'peak_pcm16': peak, 'sha256': hashlib.sha256(wav).hexdigest()})
            finally:
                process.terminate()
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired: process.kill(); process.wait()
        assert 'EGRESS_PROBES_BLOCKED' in log_path.read_text(encoding='utf-8')
    report = {'restart_and_synthesis_pass': True, 'os_firewall_verified': '--firewall' in sys.argv, 'runs': evidence}
    (output / 'service-test.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))
