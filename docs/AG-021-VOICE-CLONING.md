# AG-021 — Local reference-audio voice cloning

## Verified engine and input

The archived source is commit `85344322b7258b4e25479b692e8e3396baf9db34` and installed package `vieneu==3.8.3`. Production uses the saved v3 Turbo ONNX update artifacts, not an author's API. The pinned model card in `services/tts/artifacts/models/vieneu/README.md` documents **3–8 second references**. In the installed engine, `_MAX_REF_SECONDS = 8.0`; the raw engine caps longer clips but does not implement a quality-based 3-second minimum. Our service enforces 3–8 seconds and at least 3 seconds between audible sample boundaries; this is an application acceptance rule.

Local source evidence:

- `vieneu/v3turbo.py`: `encode_reference(ref_audio, denoise=True)` returns `(speaker_emb, ref_codes)`; `infer(text, ref_audio=...)` enrolls inline; a saved voice dictionary accepts `speaker_emb` and `codes`.
- `_v3_turbo_engine/onnx_runtime_lite.py`: `prepare_reference()` loads/downmixes audio, caps at 8s, optionally denoises, extracts the speaker embedding and codec reference frames.
- `_v3_turbo_engine/speaker/onnx_extractor.py`: a **192-dimensional** speaker vector, Kaldi 80-bin fbank front-end, 16 kHz resampling.
- `onnx_update/config.json`: 48 kHz output, **16 codec channels**, 1024 audio codebook entries. Reference codes in the OS-isolated fixture had shape `[59,16]` (frame count varies with reference duration).

No reference transcript, training/fine-tuning, remote speaker API or new model downloads are required. The service loads the local speaker encoder and denoiser during startup. `local_engine.py` adapts the SDK's temporary-file destination to a private local runtime directory; the pinned source/package is unchanged. Files created by enrollment and SDK trimming are removed after processing. The service clears its reference cache after enrollment so revoked references do not remain cached there.

Supported upload: **PCM16 WAV**, mono/stereo, 16–48 kHz, 3–8 seconds, at most 4 MiB, audible speech. MP3/M4A conversion is not implemented. Use one speaker in a quiet recording. Enrollment produces reusable vectors/codes; new speech reads those from MongoDB rather than repeatedly processing the sample.

The client decodes browser-supported WAV (including float WAV) locally, downmixes to mono and sends canonical PCM16 at 48 kHz. It checks duration and audible sample boundaries before enabling submit. At most 50 ms of export/resampling padding beyond 8 seconds is trimmed; longer recordings are rejected. The API still strictly enforces its 3–8s PCM16 contract and returns separate `CLONE_SAMPLE_DURATION_INVALID` and `CLONE_SAMPLE_FORMAT_INVALID` codes with safe messages. The modal scrolls in short viewports and brings validation errors into view.

## API and storage

All application routes require session authentication. Mutations additionally require CSRF.

| Route | Input / behavior |
| --- | --- |
| `GET /api/voice-enrollments` | Owner's enrollments, actual plan eligibility, input limits and consent version. No sample URL, provider ID or vectors. |
| `POST /api/voice-enrollments` | `Idempotency-Key` header; JSON `{name,audioBase64,consentToClone:true,hasVoiceRights:true,consentVersion:"voice-cloning-v1"}`. Returns enrollmentId, voiceId, jobId and reused. |
| `POST /api/voice-enrollments/:id/revoke` | Owner only, transitions to REVOKED, immediately removes stored reference vectors and disables new generation; schedules protected sample deletion. |
| `DELETE /api/voice-enrollments/:id` | Owner only, transitions to DELETED and schedules deletion. Idempotent; audit tombstone retained. |
| `GET /api/voices` | ACTIVE system voices allowed by plan, plus only caller-owned ACTIVE clones for PLUS/PRO. |
| Existing TTS/scene APIs | Receive the database voiceId only; resolve owner, current plan, status and reference internally. |

Enrollment states: **PENDING → ACTIVE**, or **PENDING/ACTIVE → REVOKED → DELETED**. Failed enrollment becomes REVOKED with a safe error code. A revoked voice cannot become ACTIVE again: submit a new enrollment with fresh consent.

`voice_enrollments` stores owner, links to Voice/Job, immutable request fingerprint, consent booleans/version/timestamp, sample checksum/duration, internal authenticated Cloudinary ID and cleanup state. Voice stores ownerId, enrollmentId, provider `VIENEU_LOCAL`, backend-only providerVoiceId and reusable `clonedReference` with `select:false`. Controllers explicitly map safe DTOs.

Only PLUS/PRO can enroll or synthesize cloned voices. Entitlement comes from the server's User.plan, never roles, credit balance, request parameters or a UI toggle. Revocation/deletion remain available to the owner after a plan downgrade.

The API stages a validated sample outside public web roots under ignored `services/tts/.runtime/enrollment-staging/`, with private filesystem modes. The **Worker**, not Client/API, calls internal authenticated `POST /enroll` and uploads the sample to **Cloudinary video/authenticated**. It checks delivery checksum before extracting the reference. Only signed backend delivery requests can read the sample; no sample delivery route or URL is returned to the client.

The sample remains in authenticated storage while the voice is ACTIVE. Revoke/delete removes reference vectors immediately and asynchronously deletes the Cloudinary object and local staging. Cloud deletion response must be `ok` or `not found`. Three cleanup attempts are bounded; `cleanupPending` remains visible if unavailable. Repeat the owner revoke/delete request to re-arm exhausted cleanup. Tombstones retain consent/audit metadata, not sample bytes or vectors. Already-generated speech is separate media and remains in the owner's TTS history; revocation prevents new speech, it does not delete those outputs.

Worker jobs use durable Mongo leases, heartbeats, execution fences and at most three claims. Publication and revocation conflict through the same Voice/Enrollment documents; plan downgrade conflicts through User. Revoke during upload re-arms cleanup when the upload completes. Old sample spools from interrupted requests are swept after one hour when no PENDING enrollment requires them. Reference processing has a 120s timeout and up to three transient retries, shared with the existing provider configuration.

There is **no separate enrollment credit fee** in AG-021. Speech retains `ceil(Unicode character count / 100) * TTS_CREDITS_PER_100_CHARS` (currently 100) and the existing atomic reserve/settle/release ledger. Failed/revoked/denied jobs release once, and successful replay neither synthesizes nor charges twice. Client selectors in standalone TTS and Scenes include real owned clones. The Voices page uses database statuses and consent unchecked by default; mock premium toggles, mock files, mock voices and invented accuracy percentages have been removed from the active UI.

## Validation and operations

```powershell
services/tts/.venv/Scripts/python.exe services/tts/test_clone_offline.py
pnpm -C apps/backend-api run test:tts
pnpm -C apps/backend-api run test:clone:local
pnpm -C apps/web-client run build
pnpm -C apps/web-client run test:clone # Requires backend dist from build above
pnpm -C apps/web-client run test:clone:browser # Chrome installed; local Vite on 5173
cd apps/backend-api
node scripts/test-clone-local.cjs --eight-seconds
```

The default offline test denies DNS and every Python socket connection before loading the model. The stronger test was also run with **Windows Firewall blocking outbound traffic for both the dedicated venv Python and base Python executables**, with Python-only network hooks disabled (`test-firewall.ps1 -Clone`). GitHub, Hugging Face and the author's site probes fail; enrollment and synthesis still produce a WAV. It uses a synthetic reference generated from the consented bundled Hai Dang preset, not a human-user recording. Result: `services/tts/offline-output/clone/acceptance.json`, output `cloned.wav`, OS-isolation transcript `firewall-admin.log`. This proves the local reference-audio path works, **not** a measured similarity/accuracy score for a real user's voice. The application test uses real local API/Worker/model/MongoDB/Cloudinary with isolated temporary users and removes its fixtures afterward.

Recorded acceptance on 2026-10-02:

- Offline OS isolation: PASS, three external probes blocked, 4.72s reference → 4.08s output, PCM16 WAV at 48 kHz. Temporary firewall rules removed after test.
- Real application pipeline: PASS, 4.96s cloned WAV played with Windows SoundPlayer. Protected reference download succeeds only via backend signing; unsigned delivery denied. Owner/plan/consent/CSRF, enrollment retries, TTS single reservation/settlement, revoke/refund and Cloudinary sample deletion passed; temporary database fixtures removed.
- Backend TTS regression: 34 unit/provider tests plus 8 Mongo replica-set enrollment/credit tests PASS (separate processes prevent global unit mocks affecting real DB tests).
- Frontend TypeScript + production build PASS; backend build PASS. API and local TTS readiness PASS.

Clone upload fix validation on 2026-10-02: five client preflight tests and eight replica-set enrollment/credit tests PASS. Actual headless Chromium decoded a stereo float32 WAV of exactly 8s into mono PCM16, clipped 8.04s export padding to 8s, and rejected 8.06s, silent and corrupt samples. The real API/Worker/model accepted an 8s synthetic reference, persisted the ACTIVE clone, returned distinct duration/format HTTP 400 codes for invalid fixtures, and generated a 4.72s PCM16 WAV at 48 kHz. Windows SoundPlayer playback PASS. Ownership, private sample storage, credit idempotency, revoke/release/delete PASS; temporary database fixtures removed. Report: `services/tts/offline-output/clone-integration-8s/acceptance.json`. The reported user's audio/HTTP response was not available, so these checks do not identify their original HTTP 400 code.

Inference/enrollment requires no Internet. Cloudinary upload/download/delete and a remotely hosted MongoDB still require their network endpoints. The full application pipeline is therefore not an entirely offline storage system. Deployment must protect MongoDB access/backups and the runtime directory; on Windows run the service under a dedicated account with private directory ACLs, on Linux use a service account and modes 0700/0600. Keep model artifacts out of Git.

No existing `.env` values or end-user plan records are changed. Existing system voices need no migration; initialize the new `voice_enrollments` indexes and restart the TTS supervisor/Worker once the active queue is empty. The local launcher remains `node scripts/start-local-tts.cjs`.
