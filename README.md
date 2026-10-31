# MediBook

**MediBook is a full-stack clinic appointment platform for patients, clinicians, and clinic administrators.** It combines a Next.js web app with a NestJS API to support clinician discovery, availability management, appointment booking, and operational oversight.

> **Project status:** Technical release candidate. Use demo data only; the documented privacy, identity, hosting, and operational launch gates must be completed before handling real patient information. See [Production readiness](PRODUCTION_READINESS.md).

## What it does

- **Patients** can create an account, find clinicians by search and specialty, view available time slots, and book, cancel, or reschedule appointments.
- **Clinicians** can publish availability, review appointments, and manage appointment outcomes.
- **Administrators** can manage user and clinician accounts, review operational statistics, and inspect audit events.
- **The platform** queues appointment reminders and records important changes for traceability.

The API exposes versioned REST endpoints under `/api/v1`. Local development includes Swagger documentation at `http://localhost:3000/api/docs`.

## Architecture

~~~mermaid
flowchart LR
    User[Patient, clinician, or administrator] --> Web[Next.js web app]
    Web -->|REST /api/v1| API[NestJS API]
    API --> DB[(MySQL)]
    API --> Queue[(Redis + BullMQ)]
    Queue --> Worker[Reminder worker]
    Worker --> SMS[Console locally / Twilio in production]
~~~

The web app runs on port 3001; the API runs on port 3000. MySQL and Redis are provided for local development by Docker Compose.

## Engineering highlights

- **Concurrency-safe booking:** the API locks the selected availability row and commits the appointment, audit event, and reminder outbox entry in one transaction. A generated `active_slot_id` column with a unique index is the database-level backstop against double booking.
- **Consistent appointment changes:** cancellation and rescheduling update the reminder outbox transactionally. Queue job IDs include appointment and slot versions, and the worker rechecks the appointment before sending.
- **Hardened sessions:** refresh tokens are opaque, stored as SHA-256 hashes, and rotated. Reusing a replaced token revokes its active token family.
- **Access controls and operations:** role and ownership checks, request validation, rate limiting, structured logs, request IDs, and readiness checks are built into the API.
- **Migration-led releases:** production schema synchronization is disabled; reviewed migrations are run as a separate release step. Swagger is disabled in production.

## Technology

| Layer | Tools |
| --- | --- |
| Web | Next.js 16, React 19, TypeScript |
| API | NestJS 11, TypeORM, class-validator, Joi |
| Data and jobs | MySQL 8, Redis, BullMQ |
| Security and operations | JWT, Argon2, Helmet, throttling, Pino, Swagger |
| Local development | Node.js 20.9–24, pnpm 11, Docker Compose |

## Repository layout

- `api/` — NestJS modules, migrations, seeds, API documentation, and unit/e2e suites.
- `web/` — Next.js patient, clinician, and administrator experience.
- `docker-compose.yml` — local MySQL and Redis services.
- `PRODUCTION_READINESS.md` — implemented release controls and remaining launch gates.
- `MediBook-Final-Plan.md` and `HANDOFF.md` — product and implementation context.

## Run locally

### Requirements

- Node.js 20.9 or later, below 25
- pnpm 11
- Docker Desktop with Docker Compose, or local MySQL 8 and Redis-compatible services

Start the local data services from the repository root:

~~~powershell
docker compose up -d mysql redis
~~~

Configure and start the API:

~~~powershell
cd api
pnpm install
Copy-Item .env.example .env
Copy-Item .env.test.example .env.test
pnpm run migration:run
pnpm run seed:demo
pnpm run start:dev
~~~

The Compose MySQL service is available at `localhost:13306`; Redis is available at `localhost:6379`. Review the copied environment files and keep their development-only values out of deployed environments. The demo seed is blocked in production.

In a second terminal, start the web app:

~~~powershell
cd web
pnpm install
Copy-Item .env.example .env.local
pnpm run dev
~~~

Open `http://localhost:3001`. The API health endpoints are `/api/health/live` and `/api/health/ready`; the readiness endpoint checks MySQL, Redis, and the SMS worker.

For the full environment contract, local demo accounts, migrations, production configuration, and troubleshooting, see [api/README.md](api/README.md).

## API at a glance

| Area | Example capabilities |
| --- | --- |
| Authentication | Register, log in/out, refresh a session, and retrieve the current user |
| Clinician discovery | Search and paginate clinicians, browse specialties, and view date-specific slots |
| Patient appointments | Book, list, cancel, and reschedule appointments |
| Clinician workspace | Review appointments, manage availability, and complete or cancel visits |
| Administration | Add clinicians, manage account status, view statistics, and inspect audit logs |
| Health | Separate liveness and dependency-aware readiness endpoints |

List endpoints return paginated `data` and `meta` fields. API errors use a stable response shape and include a request ID.

## Quality checks

From `api/`:

~~~powershell
pnpm run lint
pnpm run build
pnpm run test:unit
pnpm run test:e2e
pnpm exec typeorm-ts-node-commonjs -d typeorm.config.ts schema:log
pnpm audit
pnpm peers check
~~~

From `web/`:

~~~powershell
pnpm run lint
pnpm run typecheck
pnpm run build
~~~

The e2e environment uses the separate `medibook_test` database and Redis database 1; provision them as described in [api/README.md](api/README.md) before running `pnpm run test:e2e`. The API e2e suite covers authentication, authorization and ownership, clinician and slot discovery, concurrent booking, appointment changes, administration, audit events, health checks, and the database booking constraint. GitHub Actions runs the repository’s CI checks; it does not deploy the application.

## Production readiness

The codebase includes security and release controls, but the repository does not yet define a production host, live provider credentials, an approved privacy and consent policy, or recovery objectives. Before a real-user launch, complete the deployment, legal/privacy, identity, messaging-consent, backup/restore, monitoring, load, and security review gates documented in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).