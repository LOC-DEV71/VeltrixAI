# Content generation

`GET /api/contents/generation-config` returns capabilities from the authenticated user's database plan. Request fields cannot override that plan; the worker rechecks it before inference.

| Plan | Selectable duration (seconds) | Scenes | Controls |
| --- | --- | --- | --- |
| Free | 15, 30, 45, 60 | Automatic, 3–4 | Basic, concise script |
| Plus | 30, 60, 90, 120, 180, 240, 300 | Automatic or 5–12 | AIDA, PAS, storytelling, custom CTA |
| Pro | 30, 60, 90, 120, 180, 240, 300, 420, 600 | Automatic or 5–20 | Plus controls, creative brief, visual style |

Topic, platform, audience and tone remain part of every generation request. The prompt separates creator input from system rules, specifies duration and scene bounds, and requires English visual prompts. Long scripts receive per-scene narration guidance. Duration is an estimate, not a guarantee of final synthesized audio length.

Invalid JSON, scene count, duration or narration length triggers one bounded correction attempt. Failed generation releases reserved credit and preserves previous scenes. Valid generation persists scenes and creator settings before exposing a completed job. The AI script fee remains 20 credits per generation; TTS is separately priced at 100 credits per started 100 trimmed Unicode characters.

Validation: `pnpm -C apps/backend-api run test:content`. Real API/model/database acceptance uses isolated temporary accounts: `node apps/backend-api/scripts/test-content-plans-local.cjs`; add `--limits` to exercise the longest supported durations. Reports contain counts and statuses, not generated narration or secrets. Fixtures are removed only once their jobs have stopped.
