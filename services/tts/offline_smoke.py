"""Python-level egress test, not OS firewall certification."""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

def reject_connect(event, args):
    if event == 'socket.connect': raise PermissionError('OFFLINE_TEST_EGRESS_BLOCKED')
sys.addaudithook(reject_connect)
for url in ['https://github.com', 'https://huggingface.co', 'https://vieneu.io']:
    try:
        urllib.request.urlopen(url, timeout=3)
        raise RuntimeError('Unexpected outbound connection')
    except (PermissionError, urllib.error.URLError): pass
from local_engine import load_model
import numpy as np
import soundfile as sf
model = load_model()
audio = model.infer('Xin chào các bạn. Đây là bản kiểm tra giọng đọc tiếng Việt chạy trên máy local.', voice='Hải Đăng')
assert len(audio) > model.sample_rate and np.max(np.abs(audio)) > 0.001
output = Path(__file__).resolve().parent / 'offline-output'
output.mkdir(exist_ok=True)
sf.write(output / ('smoke-' + sys.argv[1] + '.wav'), audio, model.sample_rate)
print(json.dumps({'python_egress_blocked': True, 'sample_rate': model.sample_rate, 'duration': len(audio) / model.sample_rate, 'os_firewall_verified': False}))
