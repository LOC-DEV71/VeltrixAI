const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { inspectWave, readLimitedResponse, MAX_AUDIO_BYTES } = require('../dist/providers/AudioValidation');
const { TtsProvider, getTtsConfiguration } = require('../dist/providers/TtsProvider');
const { CloudinaryAudioProvider, signCloudinaryParameters } = require('../dist/providers/CloudinaryAudioProvider');
afterEach(() => mock.restoreAll());
function wave(duration = 1) {
  const bytes = Math.round(duration * 8000) * 2;
  const data = Buffer.alloc(44 + bytes);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(bytes, 40);
  return data;
}
const config = { url: 'http://127.0.0.1:8001', token: 'test-token-not-real'.repeat(3), timeoutMs: 1000, attempts: 3 };

test('WAV validation rejects junk, truncation, misleading duration and oversized buffers', () => {
  assert.equal(inspectWave(wave()).duration, 1);
  assert.throws(() => inspectWave(Buffer.from('not wav')), /INVALID_TTS_WAV/);
  assert.throws(() => inspectWave(wave().subarray(0, 100)), /INVALID_TTS_WAV/);
  assert.throws(() => inspectWave(wave(301)), /TTS_AUDIO_DURATION_INVALID/);
  assert.throws(() => inspectWave(Buffer.alloc(MAX_AUDIO_BYTES + 1)), /TTS_AUDIO_TOO_LARGE/);
  const invalid = wave(); invalid.writeUInt32LE(1, 28);
  assert.throws(() => inspectWave(invalid), /INVALID_TTS_WAV/);
});
test('stream limit applies even without Content-Length, and declared oversized body is rejected', async () => {
  await assert.rejects(readLimitedResponse(new Response(new Uint8Array(100)), 50), /TTS_AUDIO_TOO_LARGE/);
  await assert.rejects(readLimitedResponse(new Response('x', { headers: { 'Content-Length': '100' } }), 50), /TTS_AUDIO_TOO_LARGE/);
});
test('TTS request carries worker token, accepts audio/wav, and retries only transient errors', async () => {
  let calls = 0;
  const request = mock.method(global, 'fetch', async (url, options) => {
    assert.equal(url, config.url + '/synthesize');
    assert.equal(options.headers.Authorization, 'Bearer ' + config.token);
    assert.deepEqual(JSON.parse(options.body), { text: 'Test text', voice: 'Test voice' });
    assert.equal(options.redirect, 'error');
    return ++calls < 3 ? new Response('', { status: 503 }) : new Response(wave(), { headers: { 'Content-Type': 'audio/wav' } });
  });
  assert.equal((await new TtsProvider(config).synthesize('Test text', 'Test voice')).duration, 1);
  assert.equal(request.mock.callCount(), 3);
});
test('TTS invalid content-type/auth are terminal and never retry or include secret', async () => {
  const request = mock.method(global, 'fetch', async () => new Response('bad ' + config.token, { headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(new TtsProvider(config).synthesize('text', 'voice'), /INVALID_TTS_CONTENT_TYPE/);
  assert.equal(request.mock.callCount(), 1);
  request.mock.restore();
  const unauthorized = mock.method(global, 'fetch', async () => new Response(config.token, { status: 401 }));
  await assert.rejects(new TtsProvider(config).synthesize('text', 'voice'), error => error.message === 'TTS_AUTH_FAILED' && !error.message.includes(config.token));
  assert.equal(unauthorized.mock.callCount(), 1);
});
test('TTS uses bounded network retries and timeout signals', async () => {
  const request = mock.method(global, 'fetch', async (_, options) => {
    assert.equal(options.signal instanceof AbortSignal, true);
    throw new Error('network ' + config.token);
  });
  await assert.rejects(new TtsProvider(config).synthesize('text', 'voice'), error => error.message === 'TTS_SERVICE_UNAVAILABLE');
  assert.equal(request.mock.callCount(), 3);
});
test('TTS configuration rejects hosted author URL and accepts private service origins without printing input', () => {
  const original = { url: process.env.TTS_SERVICE_URL, token: process.env.TTS_SERVICE_TOKEN };
  try {
    process.env.TTS_SERVICE_TOKEN = config.token;
    process.env.TTS_SERVICE_URL = 'https://vieneu.io';
    assert.throws(getTtsConfiguration, /TTS_NOT_CONFIGURED/);
    process.env.TTS_SERVICE_URL = 'http://tts.railway.internal:8001';
    assert.equal(getTtsConfiguration().attempts, 3);
  } finally {
    if (original.url === undefined) delete process.env.TTS_SERVICE_URL; else process.env.TTS_SERVICE_URL = original.url;
    if (original.token === undefined) delete process.env.TTS_SERVICE_TOKEN; else process.env.TTS_SERVICE_TOKEN = original.token;
  }
});
test('Cloudinary upload is signed, authenticated, WAV/video, and deterministic without overwrite', async () => {
  const cloud = { cloud: 'test-cloud', key: '1234567890', secret: 'test-secret-not-real' };
  mock.method(global, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.cloudinary.com/v1_1/test-cloud/video/upload');
    assert.equal(options.body.get('type'), 'authenticated');
    assert.equal(options.body.get('overwrite'), 'false');
    assert.equal(options.body.get('file').type, 'audio/wav');
    const params = { public_id: 'tts/job', type: 'authenticated', overwrite: 'false', timestamp: options.body.get('timestamp') };
    assert.equal(options.body.get('signature'), signCloudinaryParameters(params, cloud.secret));
    return Response.json({ public_id: 'tts/job', asset_id: 'asset', resource_type: 'video', type: 'authenticated', format: 'wav' });
  });
  assert.equal((await new CloudinaryAudioProvider(cloud).upload(wave(), 'tts/job')).deliveryType, 'authenticated');
});
test('Cloudinary rejects public delivery and keeps signed download URLs on backend', async () => {
  const provider = new CloudinaryAudioProvider({ cloud: 'test-cloud', key: '123', secret: 'test-only' });
  const request = mock.method(global, 'fetch', async () => Response.json({ public_id: 'tts/job', asset_id: 'asset', resource_type: 'video', type: 'upload', format: 'wav' }));
  await assert.rejects(provider.upload(wave(), 'tts/job'), /CLOUDINARY_INVALID_ASSET/);
  request.mock.restore();
  mock.method(global, 'fetch', async url => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('type'), 'authenticated');
    assert.equal(Number(parsed.searchParams.get('expires_at')) - Number(parsed.searchParams.get('timestamp')), 60);
    return new Response(wave(), { headers: { 'Content-Type': 'audio/wav' } });
  });
  assert.equal((await provider.download('tts/job')).duration, 1);
});

test('Cloudinary download retries transient failure once with bounded timeout and valid WAV',async()=>{
  const provider=new CloudinaryAudioProvider({cloud:'fixture',key:'123',secret:'test-only'});let calls=0;
  mock.method(global,'fetch',async(_url,options)=>{assert.ok(options.signal instanceof AbortSignal);return ++calls===1?new Response('',{status:503}):new Response(wave(),{headers:{'Content-Type':'audio/wav'}});});
  assert.equal((await provider.download('tts/fixture')).duration,1);assert.equal(calls,2);
});
test('Cloudinary download does not retry denied access or publish invalid content',async()=>{
  const provider=new CloudinaryAudioProvider({cloud:'fixture',key:'123',secret:'test-only'});
  const request=mock.method(global,'fetch',async()=>new Response('private provider details',{status:403}));
  await assert.rejects(provider.download('tts/fixture'),e=>e.code==='CLOUDINARY_DELIVERY_DENIED'&&!e.message.includes('private'));assert.equal(request.mock.callCount(),1);
  request.mock.restore();mock.method(global,'fetch',async()=>new Response('junk',{headers:{'Content-Type':'audio/wav'}}));await assert.rejects(provider.download('tts/fixture'),/INVALID_TTS_WAV/);
});
test('Cloudinary download reports timeout after two attempts without leaking the signed URL',async()=>{
  const provider=new CloudinaryAudioProvider({cloud:'fixture',key:'123',secret:'test-only'});let calls=0;
  mock.method(global,'fetch',async()=>{calls++;const e=new Error('private signed URL');e.name='TimeoutError';throw e;});
  await assert.rejects(provider.download('tts/fixture'),e=>e.code==='CLOUDINARY_DELIVERY_TIMEOUT'&&!e.message.includes('private'));assert.equal(calls,3);
});
test('download recovers through server-only signed authenticated delivery after API timeouts',async()=>{
  const provider=new CloudinaryAudioProvider({cloud:'fixture',key:'123',secret:'test-only'});let calls=0;
  mock.method(global,'fetch',async(url,options)=>{
    calls++;
    if(new URL(url).hostname==='api.cloudinary.com'){const e=new Error('timeout');e.name='TimeoutError';throw e;}
    assert.equal(new URL(url).hostname,'res.cloudinary.com');assert.equal(options.redirect,'error');
    const expected=require('node:crypto').createHash('sha1').update('tts/fixture.wavtest-only').digest('base64url').slice(0,8);
    assert.equal(new URL(url).pathname,`/fixture/video/authenticated/s--${expected}--/tts/fixture.wav`);
    return new Response(wave(),{headers:{'Content-Type':'audio/wav'}});
  });
  const result=await provider.download('tts/fixture');assert.equal(result.duration,1);assert.equal(calls,3);assert.equal(result.url,undefined);
});
