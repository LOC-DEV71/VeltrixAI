// Executes the actual browser export implementation with the real acceptance WAVs.
const fs = require('node:fs/promises'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const { inspectWave } = require(path.join(root, 'apps/backend-api/dist/providers/AudioValidation'));
(async () => {
  const output = path.join(root, 'services/tts/offline-output/ui-integration');
  const files = await Promise.all(['standalone.wav', 'scene.wav'].map(name => fs.readFile(path.join(output, name))));
  let saved; let index = 0;
  const source = await fs.readFile(path.join(root, 'apps/web-client/src/utils/combineAudio.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const context = { module, exports: module.exports, Blob, Uint8Array, DataView,
    require: () => ({ api: { get: async () => { const file = files[index++]; return { data: file.buffer.slice(file.byteOffset, file.byteOffset + file.length) }; } } }),
    URL: { createObjectURL: blob => { saved = blob; return 'blob:test'; }, revokeObjectURL() {} },
    document: { createElement: () => ({ click() {} }) }, setTimeout: action => action(),
  };
  vm.runInNewContext(code, context);
  await module.exports.downloadCombinedAudio(['/api/media/a/audio', '/api/media/b/audio']);
  const merged = Buffer.from(await saved.arrayBuffer()); const info = inspectWave(merged);
  assert.ok(Math.abs(info.duration - files.reduce((seconds, file) => seconds + inspectWave(file).duration, 0)) < 0.001);
  await fs.writeFile(path.join(output, 'combined.wav'), merged);
  index = 0; files[1] = Buffer.from(files[1]); files[1].writeUInt16LE(2, 22);
  await assert.rejects(module.exports.downloadCombinedAudio(['/a', '/b']), /INCOMPATIBLE_WAV/);
  await fs.writeFile(path.join(output, 'export-acceptance.json'), JSON.stringify({ combined_wav_pass: true, incompatible_format_rejected: true, ...info }, null, 2));
  console.log('COMBINED_AUDIO_EXPORT_PASS');
})().catch(() => { console.error('AUDIO_EXPORT_TEST_FAILED'); process.exitCode = 1; });
