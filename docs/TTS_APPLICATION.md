# Real TTS and scene audio

Both application screens now use database system voice IDs and the real internal TTS Worker. There are no fixed speaker IDs or simulated players in these screens.

## API and persistence

- `GET /api/tts/config`: authenticated pricing (`creditsPer100Chars`), input limit (`maxTextLength=3000`) and configuration availability. It exposes no provider URL/token. Estimate uses trimmed Unicode character count; final cost is reserved by the backend.
- Current TTS rate: 100 credits per started 100 characters (`ceil(characterCount / 100) * 100`); 1..100 characters cost 100, 101..200 cost 200. `SystemSettings.TTS_CREDITS_PER_100_CHARS` is persisted as 100 and the fallback is also 100. Existing jobs retain their snapshotted cost, including idempotent replay; only new jobs use the updated rate. This change does not change the AI content-generation fee.
- `POST /api/tts`: authenticated cookie, matching CSRF cookie/header, `Idempotency-Key`, body `{ text, voiceId }`. It creates an owner-scoped TTS Job with `payload.source=STANDALONE`, text/voice/cost snapshots and a credit reservation atomically. It uses the existing durable TTS Worker, validation, authenticated Cloudinary upload and atomic settlement pipeline. Completion writes `media_assets` with source STANDALONE; a project/scene is not required for standalone audio.
- `GET /api/tts/history`: the authenticated owner's most recent 100 standalone TTS jobs, including text, voiceId, status, error code, cost and protected audio result. With `?projectId=...`, it checks ownership/live project and returns the most recent 100 scene TTS jobs for that project. Completed jobs remain in Mongo; page reload never clears history. No external provider URLs/credentials are returned.
- `PATCH /api/scenes/:id`: authenticated owner and CSRF required. Body `{ narration, voiceId, revision }`. It validates the voice entitlement and uses compare-and-swap revision updates; conflicts return `409 SCENE_EDIT_CONFLICT`. Changed text/voice increments revision and removes the old scene audio reference. The old media itself is preserved. Scene TTS requests snapshot this saved revision; stale jobs fail and release credit.
- Existing `POST /api/scenes/:id/tts`, `GET /api/jobs/:id` and `GET /api/media/:id/audio` retain the owner-only playback pipeline. Standalone media delivery additionally verifies a completed owner Job referencing that asset. Scene media still requires a live project.

Frontend selects the default voice from GET voices, allows listening to the real preview, shows backend pricing, uses stable per-operation keys for ambiguous retries and polls while jobs are queued/processing. It refreshes the account credit balance after reserve and finalization. Scene textarea and voice selection are saved before submitting TTS; the apply-all action also persists changes. Audio controls and WAV downloads use authenticated backend URLs. Export-all combines the real PCM WAV data in scene order into one WAV and rejects mixed audio formats. Generated audio from an earlier scene revision is not restored over a newer edit.

## Local service startup without modifying .env

Build backend, then run from repository root:

```powershell
node scripts/start-local-tts.cjs
```

The local supervisor starts the saved Python environment/model and a dedicated Node TTS Worker. It generates a shared token in memory and writes connection metadata to `services/tts/.runtime/connection.json`, excluded from Git. On Windows the file ACL grants only the current Windows user; other platforms use mode 0600. API/Worker provider configuration reads this local file only outside production and only when both TTS env values are absent. Existing explicit env values are respected; no real `.env` is edited. Child inference service loads local artifacts and binds to loopback. Unexpected child exit stops the other child and removes that supervisor's runtime file.

The currently launched local supervisor runs in the background with a hidden window; ready/error logs are under `.runtime/`. Restart it with the command above after reboot. Production must configure `TTS_SERVICE_URL`/`TTS_SERVICE_TOKEN` through its service supervisor and keep Worker running separately; the local file fallback is disabled in production. Cloudinary upload/playback require Internet; Python inference does not.

## Acceptance

`node apps/backend-api/scripts/test-tts-ui-local.cjs` exercises the actual running API on localhost:3001 and persistent Worker. It creates isolated temporary users/wallets/project/content/scene, checks standalone creation replay/one reserve, real scene edit + revision conflict, Worker completion/media persistence, protected audio delivery, database history/content restoration and one settlement. The test removes only its temporary fixtures/private Cloudinary uploads; it does not spend real user credit. Results are in `services/tts/offline-output/ui-integration/acceptance.json`.

`node apps/web-client/scripts/test-combine-audio.cjs` runs the actual frontend WAV export code against those real audio files. It verifies combined duration/format and rejects incompatible PCM formats. WAVs for standalone, scene and combined output all passed Windows SoundPlayer Load/PlaySync. Build/typechecks passed; 57 backend regression tests passed. These are API/audio/runtime validations; browser interaction was not automated.

Fixtures are removed after acceptance. Real user requests made from either screen persist as that user's jobs/media/scenes/history in Mongo and Cloudinary.

## Playback latency fix

WAVs remain persisted on Cloudinary, with metadata/hash/audio IDs in Mongo. Previously each playback request downloaded the full protected Cloudinary WAV before replying, and frontend `preload=none` deferred that work until Play. Backend now keeps a private, checksum-verified local audio cache capped at 256 MiB, coalesces concurrent cache misses and supports HTTP byte ranges (206/416). Worker primes this cache with its already verified download before publishing completion. Cache misses retrieve the saved Cloudinary object, never synthesize or charge credits again. Ownership/live-project or completed standalone-job checks still run before every cached response; responses remain `private, no-store`. Cache is disposable and excluded from Git. Frontend uses metadata preload so duration/header loading starts before Play. A cold/evicted cache can still require one Cloudinary download.

Read-only verification of the content shown in the reported screenshot found two saved scene WAVs (4.72 seconds/453164 bytes and 8 seconds/768044 bytes). Warm backend Range responses measured 136 ms and 134 ms including database access, with no source downloads. Ownership rejection and invalid Range were checked against those saved assets. `audio-cache.test.cjs` additionally verifies concurrent-miss deduplication, cached playback with the source unavailable and corrupt-cache repair.
