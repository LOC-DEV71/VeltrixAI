# AG-022 — Plans and entitlements

## Source of truth and deployment

`Plan` points to an immutable `PlanRevision`. All admission checks, worker checks,
prices and user-facing limits come from that revision. `PlanAudit` records the
actor, time, reason, action and field-level diff. SystemSettings values are read
once during bootstrap to preserve the existing TTS price and monthly grant.
There is no runtime fallback to a hardcoded tier policy.

Supported identities: `FREE`, `BASIC_STUDENT`, `PLUS`, `PRO`. Names and slugs are
editable; the tier identity remains stable for existing user references.

```powershell
pnpm --filter @creatorai/backend-api seed:plans
pnpm --filter @creatorai/backend-api build
pnpm --filter web-admin build
pnpm --filter web-client build
```

The seed is idempotent and never overwrites an administrator's configuration.
Run it before accepting new requests on a deployment. MongoDB must be a replica
set or Atlas deployment: quota, storage, configuration, credit and publication
changes use transactions and unique indexes.

The local admin runs at `http://localhost:5174/`. Sign in using a dedicated AdminAccount 
associated with an AdminRole (`OWNER` or `ADMIN`). Ordinary client users receive 403.
Vite proxies `/api` to the backend; production must serve the admin with an
equivalent HTTPS reverse proxy. No provider credentials belong in browser env.
Production startup rejects an absent or short JWT signing secret. Existing
`.env` files were not edited for this feature.

## Administrator API

All routes below require an authenticated admin session linked to an AdminAccount. Mutations additionally
require the normal CSRF cookie and matching `x-csrf-token` header. Obtain the
token through `/api/v1/auth/csrf`; do not copy sessions into localStorage.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/admin/plans/schema` | Field descriptors, types, units, help and supported tiers |
| GET | `/api/admin/plans` | Current configurations, revisions and archive state |
| GET | `/api/admin/plans/:tier` | Current configuration, including inactive/archived plans |
| GET | `/api/admin/plans/:tier/history` | Latest 100 immutable audit entries |
| POST | `/api/admin/plans/:tier/preview` | Validate and compute diff without saving |
| PUT | `/api/admin/plans/:tier` | Create a missing tier or publish a new revision |
| POST | `/api/admin/plans/:tier/rollback` | Publish the preceding configuration as a new revision |
| POST | `/api/admin/plans/:tier/archive` | Archive, retaining user references and history |

There is no DELETE route. Rollback never rewrites an old version or audit record.
The history endpoint currently returns the most recent 100 entries; older
entries remain in the database and must be retained/backed up.

Saving requires the full normalized config returned by GET/schema and:

```json
{
  "expectedRevision": 2,
  "reason": "Adjust monthly usage allowance",
  "confirmed": true,
  "config": { "...": "all sections and fields from the current configuration" }
}
```

The example is illustrative: the `config` placeholder is not a valid payload.
For creation use revision 0. Preview uses `config` and `expectedRevision`, or
`action: "ROLLBACK"` / `"ARCHIVE"`. Save reasons are 5–1000 characters.
Concurrent updates return 409 `PLAN_REVISION_CONFLICT`. Restrictive changes
return `PLAN_CONFIRMATION_REQUIRED` unless explicitly confirmed. The server
computes the diff again on save; the browser cannot override this requirement.

`GET /api/plans` exposes active public configurations. `GET /api/plans/me`
returns the authenticated account's effective configuration for new requests.
Neither exposes provider voice IDs, keys, paths or internal prompts.

## Normalized configuration

| Section | Fields |
| --- | --- |
| overview | name, slug, description, active, displayOrder, highlighted |
| pricing | monthlyPrice, yearlyPrice, monthlyAvailable, yearlyAvailable |
| credits | monthlyGrant, paidAllowed, expiresAfterDays, rolloverAllowed, maxRollover, ttsPer100Chars, contentCost |
| content | enabled, maxInputChars, maxOutputChars, monthlyChars, monthlyJobs, maxDurationSeconds, defaultDurationSeconds, advanced, creativeDirection, languages, modes |
| scenes | enabled, maxScenes, maxNarrationChars |
| prompts | imageEnabled, videoEnabled, monthlyGenerations |
| regeneration | enabled |
| history | retention |
| storage | maxProjects, maxWorkspaces, maxContents |
| tts | enabled, maxTextChars, monthlyChars |
| clone | enabled, maxVoices, monthlyEnrollments, minReferenceSeconds, maxReferenceSeconds, maxFileBytes, maxTextChars, monthlyChars, monthlySeconds, concurrentJobs, premiumSystemVoices |
| limits | concurrentJobs, concurrentAiJobs, requestsPerMinute, queuePriority |

Prices, monthly credit grants and display order are nonnegative integers. Other
finite numeric limits are positive safe integers. Only fields marked nullable
in `/schema` accept null (no plan cap). Disabled cloning requires every clone
numeric field to be null; this means not applicable, not permission to clone.
Premium system voices are an independent entitlement. Creative direction is
Pro-only and cannot be enabled for another tier. Supported modes are `auto`,
`aida`, `pas`, `storytelling`; language lists are configured explicitly.

The installed clone engine requires 3–8-second references and at most 4 MiB.
Admin can narrow those bounds but cannot exceed them or make them unlimited.
Other global infrastructure safeguards still apply independently of plan caps:
the current self-host TTS service accepts at most 3000 characters per inference,
and the provider validates WAV size/duration. A null plan cap does not remove
those resource safeguards. Larger TTS jobs require an engine/chunking upgrade.

Initial bootstrap defaults preserve Free 60 seconds, Plus 300 seconds, Pro 600
seconds and the existing credit policy. These are editable database values,
not frontend/worker tier maps. Basic Student starts with the basic AI policy
and no clone permission; administrators can enable non-Pro-only features.

## Request and worker enforcement

Every admitted job stores `payload.entitlementSnapshot`, including exact plan
revision/config, cost, priority and quota reservation. Workers verify the
snapshot against its immutable database revision and validate the same rules.
They do not read the plan's newest version to replace an old job's policy.
Revoked voices, missing ownership and banned users remain security failures,
even if a previous plan revision allowed the feature.

Quota and rate periods use UTC calendar months/minutes. Unicode code points
are counted after trimming leading/trailing whitespace. TTS costs:
`ceil(characters / 100) * snapshotted ttsPer100Chars`.

Content writing and splitting count admitted monthly jobs. Generated narration
counts towards monthly content characters; visual prompts count separately.
Prompt-only jobs consume prompt quota, preserve narration/audio and do not
consume generated narration quota. Every image/video scene prompt is one
generation, including prompts created with a script. Disabling either prompt
kind blanks its output; disabling both blocks prompt-only requests.

Content jobs reserve their configured maximum output (or monthly cap when no
per-request cap exists). This reservation must fit the remaining quota. On
success actual narration replaces the reservation. Failed jobs release held
characters/prompts/credits; admitted job and enrollment attempts remain counted
to prevent unlimited retry abuse. Clone seconds use an estimate at admission
and enforce the actual WAV duration before publication. Insufficient remaining
duration quota fails the job and releases credits.

Concurrency limits bound pending jobs at admission and running jobs at claim.
All worker processes share an owner execution fence. A new, higher-limit
snapshot cannot crowd out a running job with a stricter old snapshot. Jobs
wait rather than consume another attempt when no execution slot is available.
Expired execution leases can be reclaimed, with a maximum of three attempts.
Queue priority sorts lower numbers first. The local content queue is a durable
Mongo dispatcher (one AI execution per process), not a simulated queue; it may
run below the configured concurrency ceiling. Scale workers for throughput.

Revision retention is enforced when a new revision is written. Lowering it
does not immediately purge existing user history. Workspace/project/content
creation checks real owned record counts transactionally; soft-deleted projects
do not consume the project limit.

Additional content routes:

| Method | Endpoint | Behavior |
| --- | --- | --- |
| POST | `/api/contents/:id/split` | Split existing narration with scene checks |
| POST | `/api/contents/:id/prompts` | Generate permitted visual prompts for existing scenes |
| GET | `/api/contents/:id/revisions` | Owner-only saved revision history |

Stable entitlement errors include `PLAN_FEATURE_DISABLED`, `PLAN_LIMIT_EXCEEDED`,
`CLONE_VOICE_LIMIT_EXCEEDED`, `CLONE_TEXT_LIMIT_EXCEEDED`,
`TTS_TEXT_LIMIT_EXCEEDED`, `CONTENT_FEATURE_DISABLED`,
`CONTENT_INPUT_LIMIT_EXCEEDED`, `CONTENT_QUOTA_EXCEEDED`,
`SCENE_LIMIT_EXCEEDED`, `PROMPT_QUOTA_EXCEEDED`.

## Migration and immutability

Existing jobs without snapshots are bound once to the bootstrap revision.
Their stored credit costs/reservations are retained. Where an old job had no
historical tier, migration uses the owner's tier at migration time; it cannot
reconstruct unrecorded historical entitlements. Seed reports only counts.

New monthly grants store their own configuration snapshot (grant, expiration,
rollover). Later admin edits never rewrite existing credit lots. Rollover uses
each prior lot's snapshot. Legacy lots without snapshots remain unchanged.
There is no subscription/payment engine in this repository; monthly/yearly
pricing and availability are catalogue settings, not automatic charges or
fake payment success. Future subscription creation must snapshot the selected
pricing revision before integrating an actual payment provider.

The application exposes only append operations for PlanRevision/PlanAudit and
blocks document updates/deletes through Mongoose middleware. For production,
the application database principal must have read/insert access only on these
two collections; index creation and migrations use a separate operator
principal. A broad MongoDB readWrite role or direct DBA access can bypass
application middleware. Configure least-privilege database roles and retain
independent audit backups before treating the trail as infrastructure-enforced
immutable storage. No database users or privileges were changed locally.

## Verification

```powershell
pnpm --filter @creatorai/backend-api test:plans
pnpm --filter @creatorai/backend-api test:content
pnpm --filter @creatorai/backend-api test:projects
pnpm --filter @creatorai/backend-api test:tts
pnpm --filter web-admin test:plans:browser
```

Integration tests use a separate Mongo replica set and cover all numeric fields,
four tiers, stable boundary errors, monthly/rate/storage quotas, concurrent
reservations, concurrent worker claims, optimistic updates, rollback,
restrictive confirmation, OWNER/ADMIN/CSRF, old-job pricing, clone revocation,
credit snapshots/rollover, revision retention and prompt-only audio preservation.

Local acceptance scripts `test-content-plans-local.cjs` and
`test-tts-ui-local.cjs` exercise the actual API, providers, database and credits
with temporary accounts. The admin browser test checks the real page, diff,
confirmation gating and mobile width; it previews without publishing changes
to real plan configurations. Provider-backed tests require the configured
Gemini/Cloudinary connection and local TTS service. They never print secrets.
