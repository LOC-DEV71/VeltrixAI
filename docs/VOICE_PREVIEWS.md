# System voice listening samples

Six verified VieNeu v3 Turbo presets have local WAV samples: Hải Đăng (default), Mai Anh, Thùy Dung, Quang Sơn, Thái Sơn and Ngọc Trân. Exact preset names, genders and embeddings/reference codes are checked against the pinned artifact; existing REVOKED voices are never reactivated by seeding.

Sample text:

> Đây là Veltrix TTS, ứng dụng chuyển đổi văn bản thành giọng nói và sáng tạo nội dung. Biến ý tưởng của bạn thành những câu chuyện sống động, với giọng đọc tự nhiên và truyền cảm.

The provisioning Worker `src/workers/generateVoicePreviews.ts` starts a private local Python service with an ephemeral worker token, resolves seeded presets from the database and generates samples. It does not edit `.env`, call the author's API, download models or charge user credit. Run after backend build with `node apps/backend-api/dist/workers/generateVoicePreviews.js` from the repository root. It uses the existing local `.venv` and complete artifact bundle; preserve these when restoring the TTS service.

Generated files live under `services/tts/preview-audio/`, excluded from Git. Each filename is its SHA256, and Voice stores its filename/checksum/duration/text. The API exposes only `/api/voices/:id/preview`, requiring an authenticated ACTIVE user, ACTIVE system voice and matching plan entitlement. It validates the local WAV and checksum before delivery. Preview GET never performs synthesis. These cached demo samples use local protected storage; scene TTS jobs retain their Cloudinary authenticated media pipeline. Copy the preview directory together with its corresponding database records when deploying to another server; backend deployment needs access to this directory at the repository-relative location.

`GET /api/voices` now includes `previewUrl`, `previewText`, `previewDuration`. Frontend constructs the preview URL from its API origin and uses credentialed native audio controls. The voice count and Vietnamese gender labels are derived from actual API data.

Verification: backend and frontend builds PASS; provider/voice/Worker regression checks PASS. `node apps/backend-api/scripts/test-voice-previews-local.cjs` verified authenticated listing/delivery for all six WAVs, correct MIME/checksums and rejection without login; it removed its temporary auth fixtures. All six files passed Windows SoundPlayer Load/PlaySync. Evidence: `services/tts/preview-audio/acceptance.json`, `http-acceptance.json`, `playback.json`. Preview WAVs and evidence are backed up in the separate TTS backup directory.
