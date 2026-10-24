# MediBook API

MediBook is a clinic appointment platform built with NestJS, TypeORM, MySQL, Redis, BullMQ and Next.js. The API provides patient sessions, doctor discovery, appointment booking and changes, clinician availability, admin account controls, audit events and SMS reminders.

## Run locally without Docker

The API expects a MySQL 8 server and Redis-compatible server. The included `docker-compose.yml` remains available as an optional setup and has not been changed. For a native Windows setup, install MySQL and Redis-compatible services and use the local connection settings below.

| Service | Address                 | Development database                 |
| ------- | ----------------------- | ------------------------------------ |
| API     | `http://localhost:3000` | —                                    |
| Web     | `http://localhost:3001` | —                                    |
| MySQL   | `localhost:13306`       | `medibook` and `medibook_test`       |
| Redis   | `localhost:6379`        | database 0 (dev), database 1 (tests) |

The workspace was verified with Node 24, pnpm 11, MySQL 8.4 and Redis 8.10. Node 22 or 24 is suitable; the API package supports Node `>=20 <25`.

### 1. Prepare the databases

Create the application user and both databases in your MySQL administrator console. Use the same username and password in `api/.env` and `api/.env.test`.

```sql
CREATE DATABASE IF NOT EXISTS medibook CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS medibook_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'medibook'@'localhost' IDENTIFIED BY 'your-local-password';
GRANT ALL PRIVILEGES ON medibook.* TO 'medibook'@'localhost';
GRANT ALL PRIVILEGES ON medibook_test.* TO 'medibook'@'localhost';
FLUSH PRIVILEGES;
```

If MySQL listens on port `3306`, either change `DB_PORT` in both environment files or configure it to listen on `13306`. Redis must be reachable on `6379`.

### 2. Install dependencies and configure the API

```powershell
cd api
pnpm install
Copy-Item .env.example .env
Copy-Item .env.test.example .env.test
```

Edit `.env` for the development database (`DB_DATABASE=medibook`, `REDIS_DB=0`, `NODE_ENV=development`). Edit `.env.test` for the test database (`DB_DATABASE=medibook_test`, `REDIS_DB=1`, `NODE_ENV=test`, `LOG_LEVEL=silent`). Set the MySQL password to your local application password and replace both JWT values with independent random strings of at least 32 characters. Set `WEB_URL=http://localhost:3001` for browser requests.

Generate local signing secrets in PowerShell with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The Joi environment contract validates required settings at startup. Production additionally requires a strong database password, two different non-placeholder JWT secrets, schema synchronization disabled, the SMS queue enabled, and Twilio credentials.

### 3. Apply migrations and add demo records

```powershell
pnpm run migration:run
pnpm run migration:run:test
pnpm run seed:demo
```

The demo seed is blocked when `NODE_ENV=production`. Local accounts use the value of `DEMO_SEED_PASSWORD` (default `MediBookDemo123!`):

| Role    | Email                  |
| ------- | ---------------------- |
| Patient | `patient1@example.com` |
| Doctor  | `doctor1@example.com`  |
| Admin   | `admin@example.com`    |

These accounts are for local development only. Do not use the demo password or seed in a public environment.

### 4. Start the API and check it

```powershell
pnpm run build
pnpm run start:dev
```

In another terminal:

```powershell
Invoke-RestMethod http://localhost:3000/api/health/live
Invoke-RestMethod http://localhost:3000/api/health/ready
```

The readiness response should show `status: ok` with MySQL, Redis and the SMS worker all `up`. It returns HTTP 503 when a dependency is unavailable. Swagger UI is enabled locally at `http://localhost:3000/api/docs` and is disabled in production.

## Run the web app

```powershell
cd web
pnpm install
Copy-Item .env.example .env.local
pnpm run dev
```

Open `http://localhost:3001`. `NEXT_PUBLIC_API_URL` defaults to `http://localhost:3000/api/v1`. The web environment value is read at build time for a production build.

For a production-style local run, build with `pnpm run build` and start with `pnpm run start`. The build prepares the standalone output by copying its static assets, and the start script serves it on port `3001`.

## API surface

All versioned routes use `/api/v1`.

| Area    | Routes                                                                                                                                                               |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth    | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`                                                                 |
| Doctors | `GET /doctors?q=&specialty=&page=&limit=`, `GET /doctors/specialties`, `GET /doctors/:id`, `GET /doctors/:id/slots?date=YYYY-MM-DD`                                  |
| Patient | `POST /appointments`, `GET /appointments/me`, `PATCH /appointments/:id/cancel`, `PATCH /appointments/:id/reschedule`                                                 |
| Doctor  | `GET /doctor/appointments`, `PATCH /doctor/appointments/:id/complete`, `PATCH /doctor/appointments/:id/cancel`, `GET/POST /doctor/slots`, `DELETE /doctor/slots/:id` |
| Admin   | `POST /admin/doctors`, `GET /admin/users`, `PATCH /admin/users/:id/status`, `GET /admin/stats`, `GET /admin/audit-logs`                                              |
| Health  | `GET /api/health` (outside URI versioning)                                                                                                                           |

List routes return `{ data, meta }` pagination. Errors have a stable body with `statusCode`, `error`, `message`, `requestId`, `path` and `timestamp`; the request id is also returned in `X-Request-Id`.

## Tests and schema checks

Run these from `api/`:

```powershell
pnpm run lint
pnpm run build
pnpm run test:unit
pnpm run test:e2e
pnpm exec typeorm-ts-node-commonjs -d typeorm.config.ts schema:log
pnpm audit
pnpm peers check
```

The e2e suite uses `medibook_test` and covers registration/login/refresh/logout, rate limiting, role and ownership checks, doctor and slot discovery, concurrent booking, cancellation, rescheduling and rollback, doctor appointment date filtering and slot management, admin operations, security audit events, health and the MySQL generated-column booking constraint. `schema:log` should report no changes.

The optional recursive-CTE benchmark seed is capped at one million rows and is disabled in production. Use a small value against the test database to smoke-check it:

```powershell
pnpm exec cross-env NODE_ENV=test BENCHMARK_ROWS=100 pnpm run seed:benchmark
```

## Production configuration

- Keep `DB_SYNCHRONIZE=false`; apply reviewed migrations as a release step.
- Use separate random `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` values.
- Use a database and Redis password of at least 16 characters, set `DB_SSL=true` and `REDIS_TLS=true`, and keep both services on private networks. Supply `DB_SSL_CA` and `REDIS_TLS_CA` when the provider uses a private certificate authority.
- Configure `SMS_PROVIDER=twilio`, the Twilio account values, `QUEUE_ENABLED=true`, and `COOKIE_SAME_SITE` for the deployment topology. `SameSite=None` cookies are automatically marked `Secure`.
- Set `WEB_URL` to the exact HTTPS frontend origin or comma-separated origins. Production rejects localhost origins. Set `TRUST_PROXY` to the trusted proxy hop count (for example `1`) rather than `true`, and expose the API only through that proxy.
- Set the production web build's `NEXT_PUBLIC_API_URL` to the absolute HTTPS API base URL ending in `/api/v1`. This value is embedded during the build and the web build fails if it is missing or unsafe.
- Set `SWAGGER_ENABLED=false`; production configuration rejects enabling the public Swagger routes. Store credentials in the deployment secret manager, not `.env` files.
- Terminate HTTPS at the edge, restrict database and Redis ingress, and keep `.env` files out of version control.
- Use `/api/health/live` for liveness and `/api/health/ready` for readiness. Run API and web builds in CI, execute migrations as a separately reviewed release step, and verify a database restore before live use.

See [`../PRODUCTION_READINESS.md`](../PRODUCTION_READINESS.md) for the launch gates that still need real operator, legal and hosting decisions.

## Booking and time invariants

- MySQL stores datetimes in UTC. `APP_TIMEZONE=Asia/Dhaka` is the business and display timezone.
- A doctor’s bulk slot creation is capped at 200 and serializes overlap checks on the doctor row.
- Booking locks the selected availability row, snapshots the consultation fee and writes the appointment, audit event and SMS outbox rows in one transaction.
- A generated `active_slot_id` plus a unique index is the database backstop that prevents two confirmed appointments using the same slot.
- Refresh tokens are opaque, stored as SHA-256 hashes and rotated. Reuse of a replaced token revokes the remaining active token family.
- Appointment changes update the SMS outbox transactionally. BullMQ job ids include appointment and slot versions, and workers re-check the appointment before sending reminders.

For the full requirements and original system design, see [`../MediBook-Final-Plan.md`](../MediBook-Final-Plan.md) and [`../HANDOFF.md`](../HANDOFF.md).
