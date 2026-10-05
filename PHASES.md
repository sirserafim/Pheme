# Pheme — compact phase prompts

Revised 2026-10-05. These are implementation specifications, not evidence that software has been built or tests passed.

## Workflow
Copy only the current phase into a new Cursor chat, with AGENTS.md in context. Opus implements; separate Codex/Astra review checks the plan and PR. Review the plan before implementation, particularly phases 0, 1, 2, 4, 5 and 7. One phase = one branch = one PR. Resolve review findings and answer the teaching questions before the next phase.

Delivery: phases 0–7 plus phase 9 documentation/demo. Phase 3 needs a real permitted input before phase 4 if phase 2's source is unsuitable. Angular, hosting and scheduled paid calls are optional. GitHub CI and local test evidence must refer to the same commit. See SOURCES.md for dated documentation; it is not a dependency lockfile.

## Phase 0 — Reproducible setup
```text
Read AGENTS.md. Plan Phase 0 only, then await go.
Build one npm workspace, server, with ESM and strict TypeScript (including
noUncheckedIndexedAccess and exactOptionalPropertyTypes). Resolve supported
Node 24 LTS and PostgreSQL 18 patch versions; record exact versions and docs.
Check TypeScript 7 against tsx, Vitest, Biome and chosen dependencies. If tooling
cannot support it, propose a compatible stable fallback with evidence.
Configure root lint, typecheck, test:unit, test:integration, test and dev scripts.
Commit package-lock.json, .gitattributes, .nvmrc and an explicit Node engines range.
Use PostgreSQL Compose with a named volume, healthcheck and localhost-only port;
verify the chosen image's volume path. Add a least-privilege application role,
pg Pool, SELECT 1 healthcheck, bounded connection timeout and graceful shutdown.
Add per-command Zod env validation, pino redaction, .env.example and .gitignore.
Do not require LLM/API keys for lint, imports or unit tests.
CI: npm ci, lint, typecheck, unit tests; integration job on Linux with Docker
when introduced. Minimal permissions, no production secrets in PR jobs; pin
third-party actions to verified immutable revisions and document update policy.
README: purpose, Windows PowerShell commands, prerequisites and teardown.
Acceptance: clean install; env valid/invalid/redaction tests; all current checks
pass; Compose + dev logs db ok, then exits cleanly on interrupt. Record evidence.
No domain tables, external APIs or LLM calls. Teaching mode; stop.
```

## Phase 1 — Schema and migrations
```text
Read AGENTS.md. Propose SQL, constraints and query-driven indexes before go.
Create sources(id, processing/export permissions, retention policy reference),
tracked_terms(id, term, locale, UNIQUE(term, locale)),
mentions(id, source, external_id, url, title, text, language?, published_at,
fetched_at, content_hash, expires_at?, UNIQUE(source, external_id)),
mention_terms(mention_id, term_id, PRIMARY KEY(mention_id, term_id)),
ingest_checkpoints(source, term_id, completed_until, active_window, page_cursor),
ingest_runs(id, source, term_id, status, times, counts, error_code).
Use timestamptz, FKs, non-negative counts and explicit status constraints.
Keep source text nullable where absent; do not fabricate publication dates.
Implement SQL migrations using node-pg-migrate and idempotent term seeding.
Separate metadata refresh from immutable identity: ON CONFLICT DO NOTHING for
new identity and links; deliberate UPDATE for permitted source refreshes.
Acceptance on disposable Testcontainers DB: up/down/up; seed twice; same item
under two terms = one mention and two links; duplicates skipped; invalid data
rejected. Never run destructive migration tests on a real database.
Explain canonical identity, transactions, indexes and database constraints.
```

## Phase 2 — One external source and reliable ingestion
```text
Read AGENTS.md. Plan the source contract, retries and resume semantics first.
Evaluate the official YouTube API for a metadata-ingestion demonstration.
Before any real collection, document permitted storage, processing, transfer
and export for this use case. Its conditional analytics allowances do not
automatically permit our enrichment or REST/MCP export. Keep those capabilities
disabled unless verified; otherwise use a suitable permitted API/feed here.
For YouTube metadata, enforce applicable refresh/deletion deadlines (normally
within 30 days), including copies. Do not publish real payload fixtures.
Provide a purge/refresh CLI, filter expired rows out of queries/enrichment and
verify retention deadlines can be met before retaining live data. Optional
phase 9 cron is not a substitute for required maintenance.
Use SourceAdapter.fetchPage({term, windowStart, windowEnd, cursor, signal}) and
a validated result {items, nextCursor, exhausted}; document source limitations.
Implement ingest --source ... --term ... with a fixed UTC time window and small
overlap. Hold a per-source/term advisory lock on a dedicated connection.
Store each page and its next cursor in ONE transaction. Advance completed_until
only on exhaustion; budget exhaustion is partial. Resume the fixed window;
if a cursor expires, replay that window with DB deduplication. Do not equate a
search index with complete coverage. Counts distinguish inserts/refreshes/links.
Retry only classified transient errors, with full-jitter backoff, max attempts,
request timeout and total deadline. Respect Retry-After seconds or HTTP dates;
defer if the allowed wait is too short. Inspect provider error reasons; quota
exhaustion is not an immediate retry. Reserve budget per attempted request.
Persist reservations; resuming a run must not reset its cumulative budget.
Verify current source quota rules; never reuse historical quota assumptions.
Acceptance: deterministic page replay, crash/rollback, expired cursor, partial
resume, concurrent runner exclusion, retry/budget/timeout tests. Fixed fixtures
produce zero new identities on repeat; report live counts without promising zero.
Dry-run has no network or DB writes. Demonstrate one small permitted live run.
```

## Phase 3 — Permitted enrichment input and second adapter
```text
Read AGENTS.md. Select an official source whose terms permit the intended text
storage, LLM processing and demo/export. Compare two candidates using official
docs (a feed/API being public does not itself grant those rights).
Implement a second adapter or complete the permitted first source if needed.
Use a maintained feed parser when required; explain the dependency rather than
hand-writing a fragile parser. Store only allowed fields, with attribution,
expiry and capability settings. Do not scrape article bodies from result URLs.
Reuse the ingestion contract; allow small justified contract changes with tests
instead of requiring zero runner changes regardless of evidence.
Acceptance: adapter contract/fixture tests, missing-field/Unicode handling,
retention tests and one permitted live dataset for phase 4. A self-authored
corpus may support tests/demo but must be labeled synthetic, not real mentions.
Explain adapter boundaries, permissions and incomplete-source limitations.
```

## Phase 4 — Bounded LLM enrichment
```text
Read AGENTS.md. Plan SQL and work-state transitions before go.
Enrich only eligible source rows. Define sentiment toward the tracked term;
key work by mention_id, term_id, content_hash and enrichment_config_hash.
Hash prompt/schema version plus provider/model/settings; configuration changes
create new work. Persist pending/in_flight/succeeded/failed/unknown states and
attempt records. Use a dedicated advisory lock for the enrichment runner;
within it bound concurrency (initially 3). No DB transaction spans a network call.
Use AI SDK 7 structured output with Zod: positive/neutral/negative/mixed/unknown,
language tag or und. No uncalibrated confidence percentages. Treat text as
untrusted data, grant no tools, cap input/output and redact provider errors.
Central wrapper owns retries/budgets; set SDK maxRetries:0. Count every attempt,
including one allowed schema-repair attempt. Cap calls, tokens and estimated
cost; store known usage and identify unknown charges. Do not assert a hard money
ceiling when a provider's billing cannot be bounded; apply its controls too.
Keep per-run budgets cumulative across restarts, including in_flight/unknown
reservations. Test that resuming cannot reset the cap or erase attempted usage.
After success, durably store the response before local derivation. Restarted
in_flight work becomes unknown unless recoverable. Reuse request IDs/idempotency
only where supported; explicit retry-unknown warns of possible extra billing.
Acceptance: successful repeat = zero calls; two runners cannot double-dispatch;
changed text/config re-enrichs; malformed output exhausts a bounded budget;
simulated crash/timeout leaves ambiguous work visible, not silently repurchased.
Run a small eligible real sample; record actual counts/cost estimates. Teach the
difference between idempotent storage and exactly-once provider execution.
```

## Phase 5 — Reproducible AI visibility experiment
```text
Read AGENTS.md. Propose schema and metric definitions before go.
Configure brands/aliases and 10 prompts; group category, comparison and branded
prompts separately. Use two implemented provider adapters, three repetitions.
Start with a shared no-web-search mode; grounded experiments are separate and
only compare compatible capabilities. New providers may require adapter code.
Freeze prompts, aliases, locale, category, provider/model IDs, model settings,
search mode and matcher version into each run with a config hash. Resume must
use that snapshot. Record requested and returned model IDs and collection times.
Use the phase 4 ledger, cumulative budgets, lock and unknown-outcome policy. Logical sample
identity: (run_id, prompt_id, provider_config_id, repetition). Store answers before
deriving hits/citations; failed derivation resumes locally without an LLM call.
Match answer prose deterministically using Unicode-aware letter/mark/number
boundaries and escaped aliases; ordinary JS \b is insufficient for Greek.
Reject shared ambiguous aliases; count each brand once per answer. Citations
come from provider metadata, not invented links; do not fetch them automatically.
Define first appearance as prose order, NOT recommendation rank. Store matching
evidence; keep citation URLs separate from prose mention counts.
All metrics retain run/provider/model/category/locale/search-mode filters:
- visibility = successful answers with this brand / successful answers;
- share of voice = distinct answer-brand hits for this brand / all such hits;
- mean first-appearance position is conditional on the brand being mentioned.
Use null for no denominator; show planned/successful/failed/unknown counts and
completion rate. Incomplete samples and small N must remain visible.
Acceptance: hand-calculated fixtures, Greek/overlap/URL/substring tests, empty
denominators, failure bias and run isolation. Completed resume = zero calls;
changed config cannot mutate a run. Dry-run lists 60 logical samples plus retry
allowance/cost bounds; execute a bounded real run only with configured budget.
Document methodology: API responses do not reproduce consumer ChatGPT/Gemini
interfaces or measure the whole market. Avoid general claims from this sample.
```

## Phase 6 — Read-only REST API
```text
Read AGENTS.md. Build Express 5 endpoints over shared query functions:
GET /health; /api/terms; /api/mentions; /api/mentions/stats;
/api/visibility/summary?runId=... with explicit experiment filters.
Zod-validate filters/cursors; use keyset pagination with deterministic tie-breaker
(published_at, id), define null-date handling, UTC buckets and [from,to) ranges.
Counts must avoid duplication through mention_terms or enrichment versions;
select only the requested/current enrichment config, expose unenriched separately.
Use a read-only DB role and permitted-data views. Provision login credentials
outside committed migrations; migrations may define grants and NOLOGIN roles.
Bound rows, date span, statement duration and response bytes. Default loopback;
use consistent redacted errors, request IDs and explicit CORS configuration.
No write endpoints or arbitrary SQL. Public access is addressed in phase 9.
Acceptance: real PostgreSQL integration tests for filters, pagination ties,
invalid input, policy exclusions, aggregation and denied writes. Measure one
representative query workload, report environment/p50/p95 and inspect its plan;
optimise demonstrated problems without inventing performance targets/results.
```

## Phase 7 — MCP tools over the same queries
```text
Read AGENTS.md. Use stable MCP TypeScript SDK v2 and its current server package;
verify imports and schema APIs from installed types/docs. Start with stdio.
Expose search_mentions, mention_stats and ai_visibility_summary using the same
validated query services and restricted DB views as REST, not an HTTP round-trip.
Use read-only credentials, bounded parameters, typed outputs and a concise text
summary. Tool descriptions explain available filters and metric limitations.
Treat returned source text as untrusted content. No arbitrary SQL, file access,
network fetch or secrets in tool results. Send all logs to stderr, never stdout.
Acceptance: handler tests, protocol initialize/list-tools/call-tool smoke test,
actual-role INSERT/UPDATE/DELETE and CREATE/ALTER/DROP denial in application
schemas, malformed input and output-size
bounds. Verify with MCP Inspector and one real Cursor question invoking a tool.
README includes portable Windows configuration with placeholders for local paths
and credentials. Teach MCP tools/resources/prompts and transport boundaries.
```

## Phase 8 — Optional Angular dashboard
```text
Read AGENTS.md. Verify the current stable Angular compatibility table and create
web as a separate workspace with its required TypeScript version. Do not inherit
server's compiler blindly. Use standalone components, signals, typed API calls
and accessible built-in control flow; add RxJS only where it serves a clear need.
Show mentions by day/sentiment and visibility by run/cohort with sample counts,
missing results, methodology and source eligibility. Include loading/error/empty
states, labels, keyboard support and safe external links. Avoid raw HTML rendering.
At most one justified chart dependency. Acceptance: API contract/component tests
and one end-to-end filter journey against known data. Verify narrow/wide layouts
and keyboard use. No backend metrics recomputed with different UI formulas.
```

## Phase 9 — Portfolio delivery; optional hosting/scheduling
```text
Read AGENTS.md. Required even without phase 8: README, architecture, short design
decisions, versions/sources, methodology, one reproducible demo command and a
3-minute demo script. Show actual run evidence; label synthetic fixtures and
local/CI results. State missing checks, cost/retention limits and known failures.
Ensure a reviewer can install and understand it without paid API credentials.
MCP/CLI demo is sufficient when the dashboard is absent; do not claim a live UI.
If hosting is requested: propose deployment/cost/access policy first, provision
least-privilege secrets, TLS, private DB access, migrations and rollback. Publish
only eligible data, with auth where required; test unauthorised access and restore.
If scheduling is requested: enable only after a verified manual run and an
explicit schedule/budget decision. Use GitHub Actions concurrency plus DB locks,
bounded per-run spend, retention jobs and failure visibility. Cron is best effort.
Acceptance: fresh-clone instructions work; final lint/types/tests/CI evidence is
recorded; demo matches persisted data; deployed links tested only if deployed.
Teach the main trade-offs and ask interview questions; stop.
```

Optional later: another provider/source, authenticated remote MCP, embeddings or a queue only after a concrete need and measured bottleneck. They are not prerequisites for this portfolio.
