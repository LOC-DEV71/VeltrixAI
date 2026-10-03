from contextlib import asynccontextmanager
from io import BytesIO
from threading import Lock
import os
import secrets
import base64
import tempfile
from pathlib import Path
from fastapi import FastAPI, HTTPException, Response, Header
from pydantic import BaseModel, Field
from local_engine import load_model

model = None
inference_lock = Lock()
service_token = None

@asynccontextmanager
async def lifespan(app):
    global model, service_token
    service_token = os.environ.get('TTS_SERVICE_TOKEN')
    if not service_token or len(service_token) < 32:
        raise RuntimeError('TTS_SERVICE_TOKEN must be configured with at least 32 characters')
    model = load_model()
    model.infer('Xin chào.', voice='Hải Đăng')
    yield
    model = None

app = FastAPI(title='Creator AI Local TTS', lifespan=lifespan)

@app.get('/health/live')
def live(): return {'status': 'ok'}

@app.get('/health/ready')
def ready():
    if model is None: raise HTTPException(503, 'Local model not loaded')
    return {'status': 'ready', 'inference_configured': True, 'offline_verified': False}

class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=3000)
    voice: str = 'Hải Đăng'
    reference: dict | None = None

def authenticate(authorization):
    expected = 'Bearer ' + (service_token or '')
    if not service_token or not authorization or not secrets.compare_digest(authorization.encode(), expected.encode()):
        raise HTTPException(401, 'Worker authentication required')
    if model is None: raise HTTPException(503, 'Local model not loaded')

def validate_reference(reference):
    import numpy as np
    try:
        speaker = np.asarray(reference['speakerEmbedding'], dtype=np.float32)
        raw = np.asarray(reference['codes'])
        if speaker.shape != (192,) or not np.isfinite(speaker).all(): raise ValueError()
        if raw.ndim != 2 or raw.shape[1] != model.engine.n_vq or not 1 <= raw.shape[0] <= 1000: raise ValueError()
        if not np.isfinite(raw).all() or not np.equal(raw, np.floor(raw)).all() or raw.min() < 0 or raw.max() > 1024: raise ValueError()
        return {'speaker_emb': speaker, 'codes': raw.astype(np.int64)}
    except Exception:
        raise HTTPException(400, 'Invalid cloned reference')

class EnrollmentRequest(BaseModel):
    audioBase64: str = Field(min_length=1, max_length=5592408)

@app.post('/enroll')
def enroll(request: EnrollmentRequest, authorization: str | None = Header(default=None)):
    authenticate(authorization)
    import numpy as np
    import soundfile as sf
    try:
        payload = base64.b64decode(request.audioBase64, validate=True)
        if len(payload) > 4 * 1024 * 1024: raise ValueError()
        info = sf.info(BytesIO(payload))
        if info.format != 'WAV' or info.subtype != 'PCM_16' or info.channels not in (1, 2) or not 16000 <= info.samplerate <= 48000: raise ValueError()
        if not 3 <= info.duration <= 8: raise ValueError()
        audio, rate = sf.read(BytesIO(payload), dtype='float32', always_2d=True)
        if not np.isfinite(audio).all() or np.sqrt(np.mean(audio ** 2)) < 0.001: raise ValueError()
        active = np.flatnonzero(np.max(np.abs(audio), axis=1) > 0.01)
        if active.size == 0 or (active[-1] - active[0]) / rate < 3: raise ValueError()
    except Exception:
        raise HTTPException(400, 'Reference must be audible PCM16 WAV, 3-8 seconds, 16-48 kHz')
    # Private local staging only; no user-supplied paths or remote URLs.
    with tempfile.TemporaryDirectory(prefix='vieneu-enrollment-') as directory:
        path = Path(directory) / 'reference.wav'
        path.write_bytes(payload)
        with inference_lock:
            speaker, codes = model.encode_reference(path, denoise=True)
            model._ref_cache.clear()
    reference = {'speakerEmbedding': speaker.tolist(), 'codes': codes.tolist()}
    validate_reference(reference)
    return {'reference': reference, 'duration': info.duration}

@app.post('/synthesize')
def synthesize(request: SpeechRequest, authorization: str | None = Header(default=None)):
    authenticate(authorization)
    if not request.text.strip(): raise HTTPException(400, 'Text must not be blank')
    voice = validate_reference(request.reference) if request.reference is not None else request.voice
    if request.reference is None:
        voices = {voice_id for _, voice_id in model.list_preset_voices()}
        if request.voice not in voices: raise HTTPException(400, 'Unknown voice')
    import soundfile as sf
    with inference_lock: audio = model.infer(request.text, voice=voice)
    output = BytesIO()
    sf.write(output, audio, model.sample_rate, format='WAV', subtype='PCM_16')
    return Response(output.getvalue(), media_type='audio/wav')
