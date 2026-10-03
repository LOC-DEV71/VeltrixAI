import os
from pathlib import Path
ROOT = Path(__file__).resolve().parent
for key in ['HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'HF_HUB_DISABLE_TELEMETRY']:
    os.environ[key] = '1'
os.environ['GRADIO_ANALYTICS_ENABLED'] = 'False'

def preclean_local_reference(ref_audio, **kwargs):
    # The pinned SDK writes trimmed clips into Path.home(). Use our private runtime
    # directory instead, without modifying the archived package/source.
    import numpy as np
    import soundfile as sf
    import uuid
    wav, rate = sf.read(str(ref_audio), dtype='float32', always_2d=True)
    wav = wav.mean(axis=1)
    indices = np.flatnonzero(np.abs(wav) > 1e-5)
    if indices.size:
        wav = wav[max(int(indices[0]) - int(.01 * rate), 0):int(indices[-1]) + int(.01 * rate)]
    directory = ROOT / '.runtime' / 'clone-temp'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = str(directory / (uuid.uuid4().hex + '.wav'))
    sf.write(target, wav, rate, subtype='PCM_16')
    return target

def load_model():
    from verify_bundle import verify_bundle
    bundle = Path(os.environ.get('TTS_BUNDLE_PATH', ROOT / 'artifacts')).resolve(strict=True)
    verify_bundle(bundle, bundle / 'manifest.json')
    model, codec = bundle / 'models/vieneu', bundle / 'models/codec'
    from vieneu._v3_turbo_engine.onnx_runtime_lite import OnnxV3LiteEngine
    # Upstream wrapper does not forward codec_dir. Reject its remote resolver.
    def fetch_local(repo, files, subfolder):
        if repo != 'OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX' or subfolder:
            raise RuntimeError('Undeclared artifact request')
        for name in files:
            if not (codec / name).is_file(): raise FileNotFoundError(name)
        return codec
    OnnxV3LiteEngine._fetch = staticmethod(fetch_local)
    from vieneu import Vieneu
    loaded = Vieneu(mode='v3turbo', backend='onnx', device='cpu', precision='fp32',
                    backbone_repo=str(model), onnx_dir=str(model / 'onnx_update'))
    # Load cloning dependencies at startup, always from the verified local bundle.
    loaded.engine._ensure_speaker_encoder()
    if loaded.engine.denoiser is None:
        raise RuntimeError('Local reference denoiser is missing')
    loaded._preclean_reference_audio = preclean_local_reference
    return loaded
