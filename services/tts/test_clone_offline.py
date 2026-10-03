"""Real pinned ONNX enrollment + synthesis with all Python socket egress blocked."""
import hashlib
import json
import sys
import urllib.request
import socket
import faulthandler
faulthandler.dump_traceback_later(60, repeat=True)
from pathlib import Path

ROOT = Path(__file__).resolve().parent
blocked_connects = []
def deny_network(event, args):
    if event == 'socket.connect':
        blocked_connects.append(str(args[1][0]))
        raise PermissionError('CLONE_TEST_EGRESS_BLOCKED')
if '--firewall' not in sys.argv:
    sys.addaudithook(deny_network)
def deny_dns(*args, **kwargs):
    blocked_connects.append(str(args[0]))
    raise PermissionError('CLONE_TEST_DNS_BLOCKED')
if '--firewall' not in sys.argv:
    socket.getaddrinfo = deny_dns
blocked_probes = 0
for host in ['https://github.com', 'https://huggingface.co', 'https://vieneu.io']:
    try:
        urllib.request.urlopen(host, timeout=3)
        raise RuntimeError('Unexpected network access')
    except (PermissionError, OSError):
        blocked_probes += 1
assert blocked_probes == 3

from local_engine import load_model
import numpy as np
import soundfile as sf

out = ROOT / 'offline-output' / 'clone'
out.mkdir(parents=True, exist_ok=True)
print('CLONE_OFFLINE_LOADING', flush=True)
model = load_model()
print('CLONE_OFFLINE_REFERENCE_GENERATION', flush=True)
# A bundled, consented preset is used as a synthetic test fixture, not a user's voice.
sample = model.infer('Đây là Veltrix TTS, ứng dụng chuyển đổi văn bản thành giọng nói và sáng tạo nội dung.', voice='Hải Đăng')
sample = sample[:int(8 * model.sample_rate)]
assert len(sample) / model.sample_rate >= 3
reference = out / 'reference.wav'
sf.write(reference, sample, model.sample_rate, subtype='PCM_16')
print('CLONE_OFFLINE_ENROLLMENT', flush=True)
speaker, codes = model.encode_reference(reference, denoise=True)
assert speaker.shape == (192,) and np.isfinite(speaker).all()
assert codes is not None and codes.ndim == 2
print('CLONE_OFFLINE_SYNTHESIS', flush=True)
audio = model.infer('Xin chào, đây là bài kiểm tra giọng nhân bản chạy hoàn toàn từ mô hình local.', voice={'speaker_emb': speaker, 'codes': codes})
assert np.isfinite(audio).all() and np.max(np.abs(audio)) > 0.001
sf.write(out / 'cloned.wav', audio, model.sample_rate, subtype='PCM_16')
result = {'passed': True, 'networkBlocked': True, 'isolation': 'windows-firewall' if '--firewall' in sys.argv else 'python-audit-and-dns', 'blockedProbeConnections': blocked_probes,
          'sampleDuration': len(sample) / model.sample_rate, 'audioDuration': len(audio) / model.sample_rate,
          'sampleRate': model.sample_rate, 'speakerShape': list(speaker.shape), 'codesShape': list(codes.shape),
          'sha256': hashlib.sha256((out / 'cloned.wav').read_bytes()).hexdigest(),
          'fixture': 'Synthetic audio from consented bundled Hai Dang preset; not a real-user similarity evaluation'}
(out / 'acceptance.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result), flush=True)
faulthandler.cancel_dump_traceback_later()
