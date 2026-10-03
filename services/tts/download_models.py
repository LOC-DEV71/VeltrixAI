"""Provision pinned ONNX artifacts. Run during setup, never from the service."""
import hashlib
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent / 'artifacts'
REPOS = [
    ('pnnbao-ump/VieNeu-TTS-v3-Turbo', '61b85e3d937fbbacb387714180e8182823512523', 'models/vieneu',
     ['README.md', 'config.json', 'denoiser.onnx', 'speaker_encoder.onnx', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json'] +
     ['onnx_update/' + name for name in ['config.json', 'tokenizer.json', 'vieneu_acoustic_cached.onnx', 'vieneu_backbone_shared.data', 'vieneu_decode_step.onnx', 'vieneu_prefill.onnx', 'vieneu_v3_heads.npz']]),
    ('OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX', 'ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae', 'models/codec',
     ['README.md', 'codec_browser_onnx_meta.json', 'moss_audio_tokenizer_decode_full.onnx', 'moss_audio_tokenizer_decode_shared.data', 'moss_audio_tokenizer_decode_step.onnx', 'moss_audio_tokenizer_encode.data', 'moss_audio_tokenizer_encode.onnx']),
]

if __name__ == '__main__':
    records = []
    for repo, revision, folder, files in REPOS:
        for name in files:
            path = ROOT / folder / name
            path.parent.mkdir(parents=True, exist_ok=True)
            url = f'https://huggingface.co/{repo}/resolve/{revision}/{name}'
            print(f'Download {repo}/{name}', flush=True)
            temp = path.with_suffix(path.suffix + '.partial')
            request = urllib.request.Request(url, headers={'User-Agent': 'CreatorAI-selfhost-provisioner'})
            digest = hashlib.sha256()
            with urllib.request.urlopen(request, timeout=120) as response, temp.open('wb') as out:
                while chunk := response.read(1024 * 1024):
                    out.write(chunk)
                    digest.update(chunk)
            temp.replace(path)
            records.append({'path': str(path.relative_to(ROOT)).replace('\\', '/'), 'sha256': digest.hexdigest(), 'origin': url, 'revision': revision})
            (ROOT / 'model-downloads.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
