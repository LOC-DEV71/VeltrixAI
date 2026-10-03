    # TTS self-host: local deployment and acceptance

    Status (2026-10-02, including shared-token authentication): local offline execution PASS. A fresh environment was installed with --no-index from the backup runtime/wheelhouse, then Windows outbound firewall blocked the environment and base Python. GitHub/Hugging Face/author negative probes were blocked. Two service starts and two non-silent 48000 Hz WAV generations succeeded. Temporary rules were removed. Evidence: offline-output/service-test.json and firewall-admin.log. AG-018 protected audio download passed Windows decoder/playback validation. Perceptual voice-quality review and server-platform validation remain pending.

    ## Pinned artifacts

    - Runtime: Windows amd64, Python 3.12.10, CPU ONNX. GPU/CUDA is not required for this configuration.
    - Package: vieneu==3.8.3; source archive commit 85344322b7258b4e25479b692e8e3396baf9db34.
    - Model: pnnbao-ump/VieNeu-TTS-v3-Turbo revision 61b85e3d937fbbacb387714180e8182823512523.
    - Codec: OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX revision ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae.
    - artifacts/ contains source, complete selected ONNX inference weights including external data, tokenizer/codec/config, voice assets in the pinned wheel, Python runtime, all 80 dependency wheels, hashed requirements.lock, extracted license texts/metadata, deployment scripts and SHA256 manifest.
    - This configuration preserves the ONNX CPU variant; unused PyTorch/GGUF variants are not required for its inference. Model and codec repositories declare Apache-2.0. Dependency license notices/metadata are retained under licenses/.
    - Model artifacts must stay out of Git. The provisioning-only download_models.py is never called from requests. local_engine.py verifies the manifest and rejects undeclared codec downloads; missing local files fail startup.

    ## Restore and run

    Copy the whole artifacts/ directory from backup to the desired location. Run scripts from its deployment/ directory. restore.ps1 creates a NEW virtual environment and installs wheels using --no-index --require-hashes. Use a writable temporary directory if Windows sandbox blocks ensurepip.

    ```powershell
    powershell -NoProfile -File .\restore.ps1 -Bundle C:\path\artifacts -EnvironmentPath C:\path\tts-venv
    $env:TTS_BUNDLE_PATH = 'C:\path\artifacts'
    # Inject TTS_SERVICE_TOKEN through the service supervisor before launch.
    C:\path\tts-venv\Scripts\python.exe .\launch.py
    ```

    The service listens only on 127.0.0.1:8001. POST /synthesize requires Authorization: Bearer with the shared TTS_SERVICE_TOKEN (at least 32 printable ASCII characters, set before startup) and accepts text and voice (default Hai Dang preset, Vietnamese spelling in code), returns audio/wav, 48000 Hz PCM16. GET /health/ready succeeds after model load and warmup; offline_verified remains false in health responses: readiness is not a certification endpoint; use the saved acceptance report. One inference runs at a time.

    This bundle targets Windows CPU. A Linux server requires a separate wheelhouse/runtime and lock for that platform, then the same offline acceptance tests; Windows wheels cannot rebuild Linux.

    ## Acceptance evidence

    verify_bundle.py validates each inventoried SHA256, provenance references, license paths and required artifact roles. Inventory success is not inference certification.

    offline_smoke.py blocks Python socket connections and creates a non-silent WAV. test_service_offline.py starts the real HTTP service twice, uses fresh request text, checks WAV format/duration/non-silence and records audio checksums. Its audit hook does not cover native-library network access, so this preliminary test cannot substitute for OS egress isolation.

    Run test-firewall.ps1 as Windows Administrator. It temporarily blocks all outbound traffic for the dedicated environment and base Python executables, checks negative probes to GitHub/Hugging Face/author service, restarts and synthesizes twice, and removes its own rules in finally. Inspect offline-output/service-test.json and logs. Listen to the generated audio. Run the restored environment against a verified backup, with the same isolation, before declaring OFFLINE PASS.

    Backup destination currently authorized: C:\CreatorAI-Backups\tts-artifacts\ (only C drive detected). A directory outside the project protects against project deletion but not drive failure. Preserve manifest, scripts, runtime, wheelhouse and test evidence together. Future cloud/external-drive copy remains needed for disk-loss protection.

    ## AG-021 reference-audio cloning

    The pinned v3 Turbo ONNX engine supports reference-audio voice cloning from 3–8 seconds of audio. The application uses private POST /enroll with Worker authentication, PCM16 WAV validation, local denoising and speaker/reference-code extraction. The resulting reference is reused by POST /synthesize through a backend-resolved voice. No downloads occur in either request. Model startup eagerly loads speaker_encoder.onnx and denoiser.onnx from the verified bundle. Full API/consent/ownership/plan and deletion details are in docs/AG-021-VOICE-CLONING.md in the application repository.

    test_clone_offline.py tests a synthetic reference and creates a cloned WAV; its default mode blocks Python DNS/socket access. For operating-system isolation, run test-firewall.ps1 -Clone as Windows Administrator. It temporarily blocks the dedicated Python executables' outbound traffic and removes only its own firewall rules in finally. Inspect offline-output/clone/acceptance.json and the firewall transcript; do not treat readiness or the Python-only test as OS isolation evidence.

    ## Components still requiring Internet

    - Initial provisioning/update: GitHub, Hugging Face, package registry and Python runtime release host; needed only to obtain new artifacts. Restore uses saved files.
    - TTS inference: designed to load only local files; Windows CPU offline runtime test has passed; a different deployment platform needs its own test.
    - Gemini content generation: Google API remains external.
    - Google login/email delivery: provider connectivity is required for these functions.
    - Cloudinary/CDN storage/playback, when used by the application: external connectivity remains required; local synthesis does not make these independent.

    No author's hosted TTS API is used. AG-018 Worker integration is documented and tested separately in docs/reports/AG-018.md. Cloudinary upload/playback still requires Internet.

