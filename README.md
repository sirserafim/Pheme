# Pheme

Pheme is a personal learning and portfolio project. It is not company work and not production
software. The planned pipeline ingests public mentions of tracked terms, stores them in PostgreSQL,
enriches them with an LLM, runs visibility experiments and exposes read-only REST and MCP access.

Current state: **Phase 0, reproducible setup.** The repository contains an npm workspace (`server`),
a PostgreSQL 18 Compose service with a least-privilege application role, and a `dev` command that
checks the database once and shuts down cleanly. It has no domain tables, no external API calls and
no LLM calls yet. See [PHASES.md](PHASES.md) for the plan and [AGENTS.md](AGENTS.md) for the rules.

## Prerequisites

- **Node.js 24.21.0** with its bundled npm 11.19.0, as pinned in `.nvmrc`. `package.json` declares
  `"node": ">=24.21.0 <25"` and `.npmrc` sets `engine-strict=true`, so `npm ci` refuses other
  versions with `EBADENGINE`.
- **Docker Desktop**, for the database and the integration tests. Phase 0 was checked with Docker
  Engine 29.4.0 and Compose v5.1.1; older versions may not support every healthcheck option used.
- **Git.** No API keys or accounts are needed in this phase.

To install Node 24.21.0 on Windows and check the download against the official checksum:

```powershell
$v = '24.21.0'; $msi = "node-v$v-x64.msi"
Invoke-WebRequest "https://nodejs.org/dist/v$v/$msi" -OutFile "$env:TEMP\$msi"
Invoke-WebRequest "https://nodejs.org/dist/v$v/SHASUMS256.txt" -OutFile "$env:TEMP\SHASUMS256.txt"
(Get-FileHash "$env:TEMP\$msi" -Algorithm SHA256).Hash.ToLower()
Select-String -Path "$env:TEMP\SHASUMS256.txt" -Pattern $msi   # the two hashes must match
Start-Process msiexec.exe -ArgumentList "/i `"$env:TEMP\$msi`"" -Wait
node --version; npm --version                                   # expect v24.21.0 and 11.19.0
```

## Setup (PowerShell)

Run these from the repository root:

```powershell
npm ci
Copy-Item .env.example .env
```

Replace the three `change-me` passwords in `.env` with generated ones (`notepad .env`). Hex
passwords need no percent-encoding in `DATABASE_URL`:

```powershell
node -e "console.log(require('crypto').randomBytes(18).toString('hex'))"
```

Use the same value for `PHEME_APP_DB_PASSWORD` and the password inside `DATABASE_URL`.
`POSTGRES_PASSWORD` should be a different value. `.env` is git-ignored; never commit it.

Start PostgreSQL and wait until its healthcheck passes:

```powershell
docker compose up --detach --wait
docker compose ps
```

On first start, `docker/postgres/init/10-create-app-role.sh` creates the `pheme_app` role. It can
log in and connect to the `pheme` database but cannot create tables, schemas, roles or databases.
The superuser in `POSTGRES_USER` is for bootstrap and admin work only; the server never uses it.

## Run

```powershell
npm run dev
```

The server validates its environment, runs `SELECT 1` as `pheme_app`, logs `db ok`, and then waits.
Press Ctrl+C to stop it: it logs `shutdown requested`, closes the connection pool and logs
`shutdown complete`. A second Ctrl+C during shutdown forces exit code 1.

Logs are JSON lines on **stderr**. Stdout stays free for command output, and later for MCP
messages. Each line has `service` and a per-process `runId`. Passwords and connection strings are
redacted, and the target database is logged as host, port, database and user only:

```json
{"level":30,"service":"pheme-server","runId":"…","db":{"host":"127.0.0.1","port":5432,"database":"pheme","user":"pheme_app"},"latencyMs":42,"msg":"db ok"}
```

The process exits with **0** after a clean shutdown. It exits with **1** if the environment is
invalid (the log names the variables, never their values), if the database check fails, or if
closing the pool fails or takes longer than 10 seconds.

**Windows note.** After Ctrl+C, `npm run dev` itself may report exit code 1 even though the server
logged `shutdown complete`. npm forwards the interrupt to the shell it started by terminating it.
To see the server's own exit code, run it without npm, then check `$LASTEXITCODE` as a separate
command after pressing Ctrl+C:

```powershell
Set-Location server
node --env-file-if-exists=../.env --import tsx src/main.ts
$LASTEXITCODE
Set-Location ..
```

## Checks

```powershell
npm run lint              # Biome lint and format check
npm run typecheck         # TypeScript 7 (tsc), no emit
npm run test:unit         # no Docker, network or keys needed
npm run test:integration  # needs Docker running; the first run pulls the PostgreSQL image
npm test                  # unit, then integration
npm run format            # apply Biome's formatting and safe fixes
```

The integration tests start their own throwaway PostgreSQL containers with Testcontainers, using
the same image and init script as Compose. They do not touch the Compose database. The test that
sends SIGINT to `dev` runs on Linux only and is skipped on Windows. On Windows, Node cannot deliver
SIGINT to a child process and terminates it instead.

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs the same checks on Ubuntu 24.04.
Push runs test the pushed commit. Pull request runs test GitHub's merge of the PR head into the base
branch, and each job summary records both SHAs.

## Teardown

Normal teardown keeps your data in the `pheme_pgdata` volume:

```powershell
docker compose stop   # stop the container; `docker compose start` resumes it
docker compose down   # remove the container and network; the volume and data stay
```

> **Destructive reset.** `docker compose down --volumes` deletes the `pheme_pgdata` volume and every
> database in it. The init script then runs again on the next `docker compose up`. Use this only when
> you intend to lose all local data, for example to start over with new passwords.

## Troubleshooting

- **Port 5432 is already in use.** This often means a local PostgreSQL is running, which you can
  check with `Get-NetTCPConnection -LocalPort 5432 -State Listen`. Set `POSTGRES_HOST_PORT=5433` in
  `.env` and change the port in `DATABASE_URL` to match.
- **`ECONNREFUSED` with `localhost`.** Use `127.0.0.1` in `DATABASE_URL`. Node may resolve
  `localhost` to IPv6 `::1`, where the container's port is not published.
- **A value in `.env` seems to be ignored.** Variables already set in the shell take precedence
  over `.env`. `Test-Path Env:DATABASE_URL` shows whether one is set, without printing it; remove it with
  `Remove-Item Env:DATABASE_URL`.
- **`EBADENGINE` during `npm ci`.** The active Node is not 24.21.0 or later 24.x. Check with
  `node --version`.
- **Changed passwords in `.env` have no effect.** Init scripts and passwords apply only when the
  volume is first created. To change the `pheme_app` password but keep the data, open `psql` as the
  admin user, enter `\password pheme_app` at the prompt, then update `DATABASE_URL`:

  ```powershell
  docker compose exec postgres psql -U pheme_admin -d pheme
  ```

  Replace `pheme_admin` and `pheme` if you changed `POSTGRES_USER` or `POSTGRES_DB`. Otherwise use
  the destructive reset above.
- **Integration tests fail to start.** Make sure Docker Desktop is running. `npm run test:unit` does
  not need Docker.

## Documentation

- [docs/versions.md](docs/versions.md): exact versions, sources, compatibility evidence and the
  update policy.
- [docs/evidence/phase-0.md](docs/evidence/phase-0.md): commands, exit codes and results for Phase 0.
