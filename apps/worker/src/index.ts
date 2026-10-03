import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
// Worker-local environment takes precedence over backend defaults. No values are logged.
const workerEnv = resolve(__dirname, '../.env');
if (existsSync(workerEnv)) process.loadEnvFile(workerEnv);
const { runTtsWorker } = require('@creatorai/backend-api/tts-worker') as typeof import('../../backend-api/tts-worker');
runTtsWorker().catch(() => {
  console.error('TTS_WORKER_STARTUP_FAILED');
  process.exitCode = 1;
});
