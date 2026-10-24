# MediBook developer handoff

**Updated:** 2026-10-24  
**Current milestone:** API, web application and local integration are implemented.  
**Local startup path:** native MySQL and Redis services; Docker is optional.

## Project state

| Area          | State           | Notes                                                                                                                          |
| ------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Product plan  | Complete        | [`MediBook-Final-Plan.md`](MediBook-Final-Plan.md) remains the source requirements document.                                   |
| API           | Implemented     | NestJS auth, roles, doctor directory, availability, booking, cancel/reschedule/complete, admin, audit and health routes.       |
| Database      | Implemented     | MySQL migrations, TypeORM metadata/naming strategy, transactional booking and generated-column double-booking guard.           |
| SMS           | Implemented     | Transactional outbox, BullMQ worker, reminder version checks, console and Twilio providers.                                    |
| Seeds         | Implemented     | Local demo seed and recursive-CTE benchmark seed, both blocked in production.                                                  |
| Web           | Implemented     | Next.js patient, doctor and admin workflows with session restoration and a single-flight refresh interceptor.                  |
| Docker assets | Preserved       | `docker-compose.yml` is unchanged and remains an optional service setup. No Docker command was needed for this implementation. |
| Git           | Not initialized | The workspace has no `.git` directory.                                                                                         |

## Start the application without Docker

### Services

The API needs MySQL 8 and Redis-compatible services. On the workspace machine, native Windows binaries are running outside the repository from `%LOCALAPPDATA%\MediBookRuntime`:

- MySQL 8.4.9 listens on `127.0.0.1:13306`; its local data is in `%LOCALAPPDATA%\MediBookRuntime\mysql\mysql-8.4.9-winx64\data`.
- Redis for Windows 8.10.2 listens on `127.0.0.1:6379`.
- `medibook` is the development database; `medibook_test` is the e2e database.

These downloaded service binaries and their data are machine-local and are not stored in the project. On another machine, install MySQL 8 and Redis-compatible services, create both databases and a least-privilege app user, then set the connection values in `api/.env` and `api/.env.test`. The optional compose setup still publishes MySQL on `13306`.

### API

From `api/`:

```powershell
pnpm install
Copy-Item .env.example .env
Copy-Item .env.test.example .env.test
```

Set `.env` to `DB_DATABASE=medibook`, `REDIS_DB=0`, `NODE_ENV=development`; set `.env.test` to `DB_DATABASE=medibook_test`, `REDIS_DB=1`, `NODE_ENV=test`, and `LOG_LEVEL=silent`. Set `DB_HOST`, `DB_PORT`, `DB_USERNAME`, and `DB_PASSWORD` for the local MySQL instance. Use separate random JWT secrets of at least 32 characters and set `WEB_URL=http://localhost:3001`.

Apply migrations and seed local accounts:

```powershell
pnpm run migration:run
pnpm run migration:run:test
pnpm run seed:demo
```

The demo accounts use `DEMO_SEED_PASSWORD` (default `MediBookDemo123!`): `patient1@example.com`, `doctor1@example.com`, and `admin@example.com`. The demo seed refuses to run with `NODE_ENV=production`.

Start the API:

```powershell
pnpm run start:dev
```

Check `http://localhost:3000/api/health/live` for process liveness and `http://localhost:3000/api/health/ready` for MySQL, Redis and SMS worker readiness. Local Swagger UI is at `http://localhost:3000/api/docs`; production disables it.

### Web

In another terminal, from `web/`:

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm run dev
```

Open `http://localhost:3001`. The browser app calls `http://localhost:3000/api/v1`, includes credentials for the httpOnly refresh cookie, restores the access token at startup and shares concurrent refresh requests.

For a production-style local web run, use `pnpm run build` followed by `pnpm run start`. The build copies Next.js static assets into `.next/standalone`; the start script serves that output on port `3001`.

## Implemented workflows

- **Patient:** register, sign in, browse/filter/paginate doctors, see date-specific availability, book, view appointment history, cancel and reschedule.
- **Doctor:** view appointments by date/status, add up to 200 open time slots per request, list/delete unused availability, cancel future visits and complete visits after their scheduled end.
- **Admin:** review platform counts, browse/filter users, create doctor accounts, activate/deactivate accounts, revoke sessions and inspect audit activity.
- **API safety:** password hashing, opaque refresh-token rotation and replay-family revocation, role and ownership checks, account token versions, request validation, login throttling, request IDs, secure cookies and a consistent error body.
- **Notifications:** appointment writes and outbox rows share a transaction; BullMQ retries SMS; reminder work checks the current appointment version before sending.

All stored datetimes are UTC. `APP_TIMEZONE=Asia/Dhaka` defines business days and display times. Doctor slot requests must include explicit UTC offsets; the web app converts its Dhaka-local time inputs to UTC before sending them.

## Verification commands

From `api/`:

```powershell
pnpm run format
pnpm run lint
pnpm run build
pnpm run test:unit
pnpm run test:e2e
pnpm exec typeorm-ts-node-commonjs -d typeorm.config.ts schema:log
```

E2E tests use `medibook_test`; migrations must be applied there first. `schema:log` should say the schema is up to date. For a small benchmark smoke run, use `pnpm exec cross-env NODE_ENV=test BENCHMARK_ROWS=100 pnpm run seed:benchmark`; the default benchmark inserts one million rows, so run it only against a database with sufficient disk space.

From `web/`:

```powershell
pnpm run lint
pnpm run typecheck
pnpm run build
```

## Verification completed

- API format, lint and production build passed.
- API unit tests passed: 5 suites, 20 tests.
- API integration/e2e tests passed: 4 suites, 20 tests, including the doctor appointment date-range filter.
- Web lint, TypeScript check and production standalone build passed.
- Local HTTP checks returned API health `ok`, Swagger `200` and five doctors.
- Codex browser smoke flow passed for doctor search/profile/availability, patient sign-in and appointment booking/rescheduling/cancellation, clinician appointment and availability management, and admin statistics, audit, doctor creation and account deactivation.
- The repeatable demo seed produced no new slots or appointments on its second run. The 100-row benchmark smoke run passed.

## Database invariants to preserve

- `appointments.active_slot_id` is a stored generated unsigned `BIGINT`, set to `slot_id` only for `CONFIRMED` rows. Its unique index is the final double-booking guard; cancellation sets it to `NULL` and frees the slot.
- The generated column must keep `insert: false` and `update: false` in its TypeORM metadata. MySQL requires `UNSIGNED` before `AS (...) STORED`; keep its migration hand-written.
- `MediBookNamingStrategy` preserves readable migration names and `schema:log` is currently clean. Do not remove it or use schema synchronization to manage production tables.
- MySQL connection timezone stays `Z`; money columns use the decimal transformer; BIGINT ids remain strings in TypeScript.
- Booking and rescheduling lock rows inside transactions and write audit/outbox records before commit. Keep the 200-slot API cap and doctor-row lock around overlap checks.

## Production release configuration

The app validates production settings at startup. Production requires explicit `NODE_ENV=production`, a database password and Redis password of at least 16 characters, different non-placeholder JWT secrets, database and Redis TLS, `DB_SYNCHRONIZE=false`, `QUEUE_ENABLED=true`, Twilio credentials with `SMS_PROVIDER=twilio`, exact HTTPS CORS origins in `WEB_URL`, and Swagger disabled. Set `TRUST_PROXY` to the actual trusted proxy hop count. Keep migrations as a reviewed release step and never run the demo seed in production. The web production build requires an HTTPS `NEXT_PUBLIC_API_URL` ending in `/api/v1`.

See [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md) for the current launch gates. The code still needs a deployment target, approved patient privacy/terms and retention policy, identity and clinician onboarding decisions, a backup/restore drill, monitoring/on-call setup, and deployment-specific load and security testing before live patient use.

No cloud deployment or one-million-row benchmark was run as part of this handoff. The local build, API, service integration and browser workflows are the verification target for this workspace.

## Docker files

`docker-compose.yml` and any Docker-related configuration were left in place. Docker remains available to contributors who prefer it, but local development and verification do not depend on it.

## Reference documents

- [`api/README.md`](api/README.md): detailed local setup, routes, tests and production configuration.
- [`MediBook-Final-Plan.md`](MediBook-Final-Plan.md): original product and technical requirements.
