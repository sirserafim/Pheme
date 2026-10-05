# Verification notes — 2026-10-05

These notes support the revised specifications. No application was implemented,
dependencies installed, compiler compatibility tested, or live experiment run.
Phase 0 must resolve exact published versions and test the selected toolchain;
later phases repeat that check for their new dependencies. A version listed here
is a researched baseline, not a promise that every combination works.

## Runtime and language
- [Node.js releases](https://nodejs.org/en/about/previous-releases): choose the supported Node 24 LTS line and its latest compatible security patch; do not adopt Current solely because its major is higher.
- [TypeScript 7 release](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) and [downloads](https://www.typescriptlang.org/download/): TypeScript 7 is stable; compiler-API-dependent tools still need compatibility checks. A stable fallback is acceptable when documented.
- [Angular compatibility](https://angular.dev/reference/versions): the checked Angular 22.0.x row requires TypeScript >=6.0 <6.1 and permits Node ^24.15.0. Recheck the exact Angular version chosen in phase 8; isolate web dependencies.
- [PostgreSQL version policy](https://www.postgresql.org/support/versioning/) and [downloads](https://www.postgresql.org/download/): select supported stable PostgreSQL 18, with matching resolved patch versions in local development and CI.

## AI and MCP
- [AI SDK introduction](https://ai-sdk.dev/docs/introduction) and [v7 migration](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0): use v7 documentation and compatible provider packages; Node 24 with ESM meets its stated runtime baseline. A simple pipeline does not need an agent framework.
- [AI SDK settings](https://ai-sdk.dev/docs/ai-sdk-core/settings): maxRetries defaults to 2; use 0 when central retry/accounting code owns attempts. Bound timeouts and output tokens.
- [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/) and [v2 migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2): stable v2 splits server/client packages. Use @modelcontextprotocol/server for the server; verify supported Zod versions, with >=4.2 as the baseline.

## Source eligibility
- [YouTube search.list](https://developers.google.com/youtube/v3/docs/search/list): verify current parameters, pagination and quota accounting against the project's actual console allocation before a live run.
- [YouTube developer policies](https://developers.google.com/youtube/terms/developer-policies), especially III.E.4, III.G.15 and III.L, and [additional analytics policies](https://developers.google.com/youtube/terms/derived-metrics-policy): retention, derived-data use and redistribution are conditional. The revised plan keeps YouTube enrichment/export disabled until applicability is established, and allows a permitted alternative. Public availability alone does not establish reuse rights.

## Design corrections
The revised files replace impossible exactly-once billing claims with explicit
stored-result guarantees and unknown-outcome recovery; define atomic checkpoints;
separate grounded/un-grounded visibility cohorts and metric denominators; add
restricted REST/MCP access, protocol tests and deterministic acceptance evidence.
These are design decisions requiring implementation tests, not security or
performance certification. No known issue list is a guarantee of no other bugs.
