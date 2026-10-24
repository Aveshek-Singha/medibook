# MediBook: Final Plan (v3)

**Goal:** NestJS + MySQL + Next.js full-stack portfolio project, সব requirement সহ।
**Priority order:** Backend core → Tests + EXPLAIN → Frontend → Docker/CI → README → Deploy

> **v3 changes (2026):** MySQL generated-column syntax fixed + TypeORM `STORED` config; 1M seed rewritten as recursive-CTE; bulk-slot cap + doctor-row lock for overlap; transactional outbox for SMS jobs; refresh-token single-flight + session rehydration; stale-job guard in the SMS processor; Swagger CSP allowance; cookie scoped to the auth path; unified env contract with Joi `when` clauses; test-DB/e2e bootstrap rules; full index set; UTC/`Asia/Dhaka` time contract; doctor-cancel + admin-deactivation rules; fee snapshot; out-of-scope section; estimate replaced by a tiered timeline.

> **Estimate correction:** the old "~11h" was decision time, not execution time. Realistic single-developer effort for the full scope is **30–45h**. The timeline (§14) is therefore tiered: T1 ships even if nothing else lands, T2 is the differentiator, T3 is polish. **Backend কোনো feature কাটব না** — but T3 কাটতে পারো।

---

## 1. Requirement Coverage Map

| Requirement | যেখানে implement হবে |
|---|---|
| JWT auth | `auth` module: access (15m) + refresh (httpOnly cookie, 7d, rotation) |
| Multi-role RBAC | `ADMIN / DOCTOR / PATIENT`, `@Roles()` + `RolesGuard` |
| Transactions | Book, cancel, **reschedule** (`QueryRunner` + `FOR UPDATE`) |
| Indexes + EXPLAIN | 1M seeded `appointments`, before/after screenshot |
| Migrations | TypeORM migrations (`synchronize: false`) |
| Queues (BullMQ) | SMS confirmation + cancellation/reschedule + 24h / 1h reminders |
| Versioned REST + OpenAPI | `/api/v1`, Swagger `/api/docs` |
| CORS/auth flow with Next.js | Credentials CORS + path-scoped refresh cookie + axios single-flight interceptor |
| OWASP basics | `ValidationPipe`, helmet (Swagger-aware CSP), throttler, argon2, safe error responses |
| Jest tests | Unit + e2e + concurrency test |
| Double-booking prevention | Pessimistic lock + DB-level unique backstop (`active_slot_id`) |
| SMS reminders via queue | `SmsProvider` interface (Console + Twilio) + transactional outbox |
| Production readiness | Env validation, pino logging, Dockerfiles, CI |

---

## 2. Stack

- **API:** NestJS 10.x, TypeORM 0.3.x, MySQL 8, BullMQ 5.x, Redis 7
- **Web:** Next.js 14.x (App Router, `output: 'standalone'`), Tailwind, axios
- **Infra:** Docker Compose (MySQL + Redis + api + web)
- **Testing:** Jest 29 + supertest
- **Logging:** `nestjs-pino` + `pino-http` + `pino-pretty` (dev)
- **Config validation:** Joi
- **Dates:** all storage UTC; display `Asia/Dhaka`; helper lib `date-fns` + `date-fns-tz`
- **CI:** GitHub Actions (MySQL + Redis services)

### 2.1 Version pins (fix BEFORE `npm install` — incompatible majors)

| Package | Pin | Reason |
|---|---|---|
| `@nestjs/throttler` | **5.x** | v5 = array config (`forRoot([{ ttl, limit }])`), v6 = object config. v6 + v5 code = runtime failure |
| `@nestjs/typeorm` / `typeorm` | 10.x / **0.3.x** | 0.3.x required for `asExpression` + `generatedType: 'STORED'` |
| `mysql2` | 3.x | `timezone: 'Z'` option support |
| `@nestjs/bullmq` / `bullmq` | 10.x / 5.x | `jobId` removal semantics |
| `argon2` | 0.41+ | native build on Node 22 |
| `jest` / `ts-jest` | 29 | Nest default |
| `next` | 14.x | `standalone` output stability |

### 2.2 Node / package hygiene

- `.nvmrc` → `22`; `package.json` → `"engines": { "node": ">=22 <23" }`
- `package-lock.json` committed; CI uses `npm ci`
- `npm` cache enabled in GitHub Actions

---

## 3. Repo Structure

```
medibook/
├─ docker-compose.yml
├─ README.md
├─ .github/workflows/ci.yml
├─ api/
│  ├─ Dockerfile
│  ├─ .env.example
│  ├─ .env.test              # CI/e2e values (DB_HOST=127.0.0.1, medibook_test, QUEUE_ENABLED=false)
│  ├─ typeorm.config.ts      # TypeORM CLI entrypoint
│  ├─ src/
│  │  ├─ config/             # configuration + Joi validation schema
│  │  ├─ auth/               # login, refresh, logout, strategies, guards, decorators
│  │  ├─ users/
│  │  ├─ doctors/
│  │  ├─ patients/
│  │  ├─ slots/
│  │  ├─ appointments/       # book / cancel / reschedule transactions
│  │  ├─ notifications/      # BullMQ producer + processor + SmsProvider + outbox dispatcher
│  │  ├─ admin/
│  │  ├─ common/             # decorators, filters, interceptors, pagination DTO, date-range util
│  │  ├─ database/           # data-source.ts, migrations/, seeds/ (demo + benchmark)
│  │  └─ main.ts
│  └─ test/                  # e2e + setup-e2e.ts (shared app bootstrap)
└─ web/
   ├─ Dockerfile
   ├─ .env.example
   └─ ...                    # Next.js
```

---

## 4. Database Schema

> **Declaration order matters.** MySQL requires a generated column to reference columns declared *before* it. `slot_id` and `status` therefore come first; `active_slot_id` comes last.

```sql
users(
  id BIGINT UNSIGNED PK AUTO_INCREMENT,
  email VARCHAR(190) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('ADMIN','DOCTOR','PATIENT') NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  phone VARCHAR(20),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  token_version INT NOT NULL DEFAULT 0,   -- bump invalidates all issued access tokens
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)

doctors(
  id BIGINT UNSIGNED PK AUTO_INCREMENT,
  user_id BIGINT UNSIGNED UNIQUE NOT NULL FK -> users(id),
  specialty VARCHAR(100) NOT NULL,
  bio TEXT,
  consultation_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)

patients(
  id BIGINT UNSIGNED PK AUTO_INCREMENT,
  user_id BIGINT UNSIGNED UNIQUE NOT NULL FK -> users(id),
  date_of_birth DATE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)

availability_slots(
  id BIGINT UNSIGNED PK AUTO_INCREMENT,
  doctor_id BIGINT UNSIGNED NOT NULL FK -> doctors(id),
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  status ENUM('AVAILABLE','BOOKED') NOT NULL DEFAULT 'AVAILABLE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_slot_doctor_start (doctor_id, start_time)
)

appointments(
  id BIGINT UNSIGNED PK AUTO_INCREMENT,
  slot_id BIGINT UNSIGNED NOT NULL FK -> availability_slots(id),
  doctor_id BIGINT UNSIGNED NOT NULL FK -> doctors(id),
  patient_id BIGINT UNSIGNED NOT NULL FK -> patients(id),
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  consultation_fee DECIMAL(10,2) NOT NULL DEFAULT 0,  -- fee snapshot at booking time
  status ENUM('CONFIRMED','CANCELLED','COMPLETED') NOT NULL DEFAULT 'CONFIRMED',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  active_slot_id BIGINT UNSIGNED
    GENERATED ALWAYS AS (IF(status = 'CONFIRMED', slot_id, NULL)) STORED,
  UNIQUE KEY uq_appointment_active_slot (active_slot_id)
)

sms_outbox(
  id BIGINT UNSIGNED PK AUTO_INCREMENT,
  appointment_id BIGINT UNSIGNED NOT NULL FK -> appointments(id),
  type ENUM('CONFIRMATION','REMINDER_24H','REMINDER_1H','CANCELLATION','RESCHEDULED') NOT NULL,
  to_phone VARCHAR(20) NOT NULL,
  send_at DATETIME NOT NULL,
  status ENUM('PENDING','DISPATCHED','FAILED') NOT NULL DEFAULT 'PENDING',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dispatched_at DATETIME
)

sms_logs(
  id BIGINT UNSIGNED PK AUTO_INCREMENT,
  appointment_id BIGINT UNSIGNED NOT NULL FK -> appointments(id),
  type ENUM('CONFIRMATION','REMINDER_24H','REMINDER_1H','CANCELLATION','RESCHEDULED') NOT NULL,
  to_phone VARCHAR(20) NOT NULL,
  status ENUM('SENT','FAILED') NOT NULL,
  attempts INT NOT NULL DEFAULT 1,
  error TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)

refresh_tokens(
  id BIGINT UNSIGNED PK AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL FK -> users(id),
  token_hash VARCHAR(128) UNIQUE NOT NULL,     -- SHA-256 of the opaque token
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME,
  replaced_by_id BIGINT UNSIGNED NULL FK -> refresh_tokens(id),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)
```

### 4.1 TypeORM entity note — generated column

TypeORM **cannot infer** the generated column. It must be declared explicitly:

```ts
@Column({
  type: 'bigint',
  unsigned: true,
  nullable: true,
  asExpression: "IF(status = 'CONFIRMED', slot_id, NULL)",
  generatedType: 'stored',
})
activeSlotId: string | null;
```

`generatedType: 'stored'` → emits `STORED` (not `VIRTUAL`). TypeORM treats the column as generated and omits it from INSERT/UPDATE payloads.

### 4.2 Indexes (complete set)

| Table | Index | Purpose |
|---|---|---|
| users | `UNIQUE (email)` | login lookup |
| users | `idx_users_role (role, is_active)` | admin user filter |
| doctors | `UNIQUE (user_id)` | 1:1 with users |
| doctors | `idx_doctors_specialty (specialty)` | specialty filter + `GET /doctors/specialties` |
| availability_slots | `UNIQUE (doctor_id, start_time)` | duplicate slot guard |
| availability_slots | `idx_slots_doctor_status_start (doctor_id, status, start_time)` | available-slot query |
| availability_slots | `idx_slots_doctor_overlap (doctor_id, start_time, end_time)` | overlap check |
| appointments | `UNIQUE (active_slot_id)` | **double-booking backstop** |
| appointments | `idx_appt_doctor_start_status (doctor_id, start_time, status)` | EXPLAIN demo main index |
| appointments | `idx_appt_patient_start (patient_id, start_time)` | patient list |
| appointments | `idx_appt_slot (slot_id)` | FK + cancel/reschedule lookup |
| appointments | `idx_appt_status (status, start_time)` | admin stats |
| sms_outbox | `idx_outbox_pending (status, send_at)` | dispatcher poll |
| sms_logs | `idx_sms_logs_appointment (appointment_id)` | per-appointment log |
| refresh_tokens | `UNIQUE (token_hash)` | **refresh lookup** |
| refresh_tokens | `idx_refresh_user_active (user_id, revoked_at, expires_at)` | revoke/cleanup |

### 4.3 Time contract (non-negotiable)

- **All `DATETIME` values are UTC.** `mysql2`/`TypeORM` options must include `timezone: 'Z'`, else mysql2 silently converts using the session timezone → off-by-hours bugs.
- `APP_TIMEZONE=Asia/Dhaka` is the only display/business-day timezone.
- `?date=YYYY-MM-DD` means a **Dhaka calendar day**. The API converts it to a UTC `[start, end)` range server-side via a shared `dhakaDayRange()` util. The frontend never sends raw UTC day boundaries for this filter.
- Same rule for doctor `from`/`to` filters and for the "upcoming 7 days" demo seed.
- `end_time` is stored explicitly on `appointments` (not derived) so list views need no join.

---

## 5. Booking Logic (Core)

### 5.1 Book: double-booking prevention

**Layer 1: Transaction + pessimistic lock**
1. `BEGIN`
2. `SELECT * FROM availability_slots WHERE id = ? FOR UPDATE`
3. Slot `AVAILABLE` না হলে, বা start time পার হয়ে গেলে → `409` / `400`
4. Slot `BOOKED` করো, `appointments` row insert করো (fee snapshot সহ), `sms_outbox` row insert করো
5. `COMMIT` → outbox dispatcher queue job add করে (transaction-এর বাইরে)

**Layer 2: DB backstop**
`active_slot_id` generated column + `UNIQUE`। MySQL-এ multiple `NULL` allowed, তাই cancelled appointments conflict করে না, কিন্তু একই slot-এ দুইটা `CONFIRMED` কখনো থাকতে পারবে না।

**Layer 3 (safety net):** unique-constraint violation (ER_DUP_ENTRY) → map to `409 Conflict`, never a 500.

### 5.2 Cancel (patient **or** doctor)

Transaction: appointment `CANCELLED` → slot `AVAILABLE` → `sms_outbox` row (`CANCELLATION`) → `COMMIT` → pending reminder jobs remove + cancellation SMS dispatch.

- Past appointment cancel করা যাবে না।
- `COMPLETED` appointment cancel করা যাবে না।
- Patient শুধু নিজের appointment cancel করবে; doctor শুধু নিজের appointment-এর doctor_id মিললে।

### 5.3 Reschedule

- শুধু নিজের `CONFIRMED` appointment, **একই doctor-এর** অন্য slot-এ
- Transaction-এ দুইটা slot **id ascending order-এ** lock করো (deadlock এড়াতে): `SELECT ... WHERE id IN (?, ?) ORDER BY id FOR UPDATE`
- Old slot → `AVAILABLE`, new slot → `BOOKED`, appointment-এর `slot_id` + `start_time` + `end_time` update
- `sms_outbox`: পুরোনো reminder rows `PENDING` → `CANCELLED`/delete, নতুন reminder rows (`REMINDER_24H`, `REMINDER_1H`) insert + `RESCHEDULED` SMS row
- Commit-এর পর: পুরোনো reminder jobs remove, নতুন job dispatch
- New slot unavailable হলে পুরো transaction rollback, পুরোনো booking অক্ষত

### 5.4 Business validation rules

- Slot: `end_time > start_time`, duration 15–120 min, future time only
- **Bulk slot create cap = 200 per request** (v2 এর 50 ছিল — এক সপ্তাহের schedule 2 request-এ ঢুকতো)
- **Doctor-row lock during bulk create:** `SELECT id FROM doctors WHERE id = ? FOR UPDATE` → তারপর overlap check। MySQL-এ `EXCLUDE` constraint নেই, তাই overlap check serialize না করলে দুইটা concurrent request দুইটো overlapping slot তৈরি করতে পারে।
- Overlap check **সব slot-এর বিরুদ্ধে** (AVAILABLE ও BOOKED দুটোই), কারণ BOOKED slot-ও সময় occupy করে:
  `WHERE doctor_id = ? AND start_time < :newEnd AND end_time > :newStart`
- Booked slot delete করা যাবে না
- Booking-এ minimum lead time (৩০ মিনিট) — env-configurable `MIN_BOOKING_LEAD_MINUTES`
- Slot start time অতীত হলে book/cancel/reschedule → `400`

---

## 6. API Endpoints (`/api/v1`)

**Auth**
- `POST /auth/register` (patient only)
- `POST /auth/login`
- `POST /auth/refresh` (cookie-authenticated)
- `POST /auth/logout` (cookie-authenticated)
- `GET /auth/me`

**Public/Authenticated**
- `GET /doctors?specialty=&page=&limit=`
- `GET /doctors/specialties` (filter dropdown; distinct specialty list)
- `GET /doctors/:id/slots?date=` (Dhaka day → UTC range)

**Patient**
- `POST /appointments` `{ slotId }`
- `GET /appointments/me?status=&page=&limit=`
- `PATCH /appointments/:id/cancel`
- `PATCH /appointments/:id/reschedule` `{ newSlotId }`

**Doctor**
- `POST /doctor/slots` (bulk create, ≤200)
- `DELETE /doctor/slots/:id`
- `GET /doctor/appointments?from=&to=&status=&page=&limit=`
- `PATCH /doctor/appointments/:id/complete`
- `PATCH /doctor/appointments/:id/cancel` **(v3 addition — doctor cancel path)**

**Admin**
- `POST /admin/doctors`
- `GET /admin/users?role=&page=&limit=`
- `PATCH /admin/users/:id/status` → deactivate হলে: `users.is_active=false`, `users.token_version++` (পুরোনো access token invalid), `refresh_tokens` revoke (নতুন refresh বন্ধ)
- `GET /admin/stats`

**System**
- `GET /health` (DB + Redis check; Redis down হলে degraded status)

### 6.1 Pagination (সব list endpoint)

Query: `page` (default 1), `limit` (default 20, max 100)
Response:
```json
{ "data": [], "meta": { "total": 0, "page": 1, "limit": 20, "totalPages": 0 } }
```

**N+1 guard:** `GET /appointments/me`, `GET /doctor/appointments`, `GET /admin/users` — QueryBuilder-এ `leftJoinAndSelect` (doctor/patient/slot/user)। Row-per-request relation load নিষিদ্ধ।

### 6.2 Consistent error format (global exception filter)

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "Slot is no longer available",
  "requestId": "b1c2...",
  "path": "/api/v1/appointments",
  "timestamp": "2026-10-23T10:00:00.000Z"
}
```
Prod-এ stack trace কখনো যাবে না। `requestId` response header `X-Request-Id`-এর সাথে হুবহু মিলবে।

---

## 7. Queue Design (BullMQ)

### 7.1 Transactional outbox (v3 — crash safety)

`COMMIT` আর `queue.add()` এর মাঝে crash হলে appointment booked থাকবে কিন্তু SMS কখনো যাবে না। তাই queue job **directly add না** করে:

1. Booking/cancel/reschedule **transaction-এর ভেতরে** `sms_outbox` row insert
2. `OutboxDispatcher` (cron/interval, API process বা আলাদা worker) `status='PENDING' AND send_at <= now` rows poll করে BullMQ job add করে → `status='DISPATCHED'`
3. BullMQ `jobId = outbox-{outboxId}` → replay-safe (duplicate add ignored)
4. Dispatcher crash-safe: row `DISPATCHED` না হওয়া পর্যন্ত repeat হবে; `jobId` dedupe হওয়ায় double SMS হবে না

### 7.2 Job ids (versioned — v3 fix)

| Job | `jobId` |
|---|---|
| Immediate SMS | `sms-{outboxId}` |
| 24h reminder | `reminder-24h-{appointmentId}-{slotId}` |
| 1h reminder | `reminder-1h-{appointmentId}-{slotId}` |

`slotId` যোগ করা জরুরি: v2-তে id ছিল `reminder-24h-{appointmentId}` — BullMQ `jobId` দিয়ে dedupe করে, তাই reschedule-এর পর re-add silently ignore হতো। এখন slot change = নতুন id।

### 7.3 Job removal (reschedule/cancel)

`queue.remove(jobId)`:
- job না থাকলে BullMQ throw করে → **try/catch করে ignore**
- job worker-এর কাছে `active` থাকলে remove হয় না → এটা **"already executing"** হিসেবে গণ্য হবে

**Stale-job guard (processor):** SMS পাঠানোর আগে processor আবার appointment-এর current `status` + `slot_id` পড়ে — appointment `CANCELLED` বা `slot_id` বদলে গেছে হলে job **skip** করে (`sms_logs` = skipped)। এটাই removal fail হলেও ভুল SMS ঠেকায়।

### 7.4 Other rules

- `delay = send_at - now`; negative হলে immediate run
- Retry: 3 attempts, exponential backoff
- Processor: `SmsProvider.send()` → `sms_logs` insert/update
- `SmsProvider` interface: `ConsoleSmsProvider` (default), `TwilioSmsProvider` (`SMS_PROVIDER=twilio` হলে)
- `QUEUE_ENABLED=false` হলে processor ও dispatcher boot হয় না (e2e/CI-এর জন্য)

---

## 8. Security (OWASP Basics)

- `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`
- **helmet + Swagger:** default CSP `script-src 'self'` → Swagger UI inline script block হয়ে `/api/docs` ফাঁকা দেখায়। Fix:
  ```ts
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:"],
      },
    },
  }));
  ```
  (অথবা `/api/docs` route-এ CSP disable — route-scoped, বাকি app-এ CSP চালু থাকবে)
- `@nestjs/throttler` (v5 pin): global 100 req/min, `/auth/login` এ 5 req/min — `@Throttle({ default: { limit: 5, ttl: 60000 } })`
- Multi-instance deployment-এ Redis-backed throttler storage + `app.set('trust proxy', 1)` (reverse proxy হলে)
- Password: argon2 (bcrypt cost 12 acceptable fallback)
- Refresh token: DB-তে SHA-256 hash করে store, rotation on refresh, logout-এ revoke
- **Access token revocation:** `users.token_version` JWT payload-এ থাকে; deactivate/reactivate-এ increment → পুরোনো access token অবৈধ
- Global exception filter (stack trace নেই, prod-এ)
- **CORS + cookie scoping:**
  ```ts
  app.enableCors({
    origin: WEB_URL.split(',').map(s => s.trim()),
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  });
  ```
  Refresh cookie: `httpOnly`, `secure` (prod), `sameSite='lax'` (same-site) / `'none'` (cross-site deploy), **`path='/api/v1/auth'`** → browser শুধু `/auth/refresh` ও `/auth/logout`-এ cookie পাঠায়।
  বাকি সব state-changing endpoint **শুধু Authorization header** (bearer) মানে → CSRF surface নেই। `/auth/*` cookie endpoint-এ extra `Origin` header check।
- Parameterized queries only, raw string concat নেই
- Secrets repo-তে নেই, `.env.example` আছে (`api/.env.example` + `web/.env.example`)

---

## 9. Observability & Config

### 9.1 Env contract (single source of truth — v3 fix)

`api/.env.example`:

```
NODE_ENV=development
PORT=3000
API_PREFIX=api
APP_TIMEZONE=Asia/Dhaka
WEB_URL=http://localhost:3000

DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=medibook
DB_PASSWORD=medibook
DB_DATABASE=medibook
DB_SYNCHRONIZE=false
DB_SSL=false

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

JWT_ACCESS_SECRET=change-me-32-chars-minimum
JWT_REFRESH_SECRET=change-me-32-chars-minimum
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

THROTTLE_TTL=60000
THROTTLE_LIMIT=100
LOGIN_THROTTLE_LIMIT=5

MIN_BOOKING_LEAD_MINUTES=30
MAX_SLOTS_PER_REQUEST=200

SMS_PROVIDER=console
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=

QUEUE_ENABLED=true
LOG_LEVEL=info
```

- `DB_*` **এবং** `DATABASE_URL` দুটোই রাখা যাবে না → একটাই (`DB_*`) ব্যবহার করো; Joi + TypeORM + compose + CI সব এই এক contract পড়বে।
- **Joi `when` clauses:** `TWILIO_*` vars শুধু `SMS_PROVIDER=twilio` হলে required; `console` provider-এ empty থাকলেও boot হবে।
- TTL গুলো hard-code নয় — env থেকে (`JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`)।
- Wrong `.env` → app boot-তেই clear error (Joi message-এ exact missing key দেখাবে)।
- `web/.env.example` → `NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1`

### 9.2 Logging / request ID / health

- **Logging:** `nestjs-pino`, dev-এ `pino-pretty`, prod-এ JSON
- **Request ID:** প্রতি request-এ UUID (`genReqId`), response header `X-Request-Id`, error body-তে `requestId`
- **Sensitive redaction:** `authorization`, `cookie`, `password` field log থেকে redact
- **Health:** `/health` DB ping + Redis ping (Redis down → `degraded`, process alive)
- **Graceful shutdown:** `app.enableShutdownHooks()` → BullMQ worker ও DB pool বন্ধ হয়, in-flight job orphan হয় না

---

## 10. EXPLAIN Demo (1M rows)

> **v3 fix:** 1M `CONFIRMED` appointment = 1M **distinct** slot (unique backstop-এর কারণে)। বাঁধাই বাঁধাই insert করলে time ও disk দুটোই ফুরিয়ে যাবে। তাই bulk insert **recursive CTE**-তে হবে।

### 10.1 Seed strategy

```sql
SET SESSION cte_max_recursion_depth = 2000000;   -- default 1000 → ছাড়ালে error
SET FOREIGN_KEY_CHECKS = 0;                       -- benchmark seed only; restore after

INSERT INTO availability_slots (doctor_id, start_time, end_time, status)
WITH RECURSIVE seq(n) AS (
  SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1000000
)
SELECT d.id,
       TIMESTAMPADD(MINUTE, (n * 37) % 525600, '2026-01-01 00:00:00'),
       TIMESTAMPADD(MINUTE, (n * 37) % 525600 + 30, '2026-01-01 00:00:00'),
       'BOOKED'
FROM seq
JOIN doctors d ON d.id = (n % 5) + 1;

INSERT INTO appointments (slot_id, doctor_id, patient_id, start_time, end_time, status, consultation_fee)
WITH RECURSIVE seq(n) AS (
  SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1000000
)
SELECT s.id, s.doctor_id, p.id, s.start_time, s.end_time, 'CONFIRMED', 500
FROM seq
JOIN availability_slots s ON s.id = n
JOIN patients p ON p.id = (n % 10) + 1;

SET FOREIGN_KEY_CHECKS = 1;
```

- প্রতিটি `CONFIRMED` row-এর নিজস্ব unique slot দরকার → slot table-ও ≥1M row (recursively seed করা হলে seconds লাগে, v2-এর 5k-batch loop নয়)।
- একটা cancelled subset যোগ করলে slot reuse দেখানো যায় (reuse করলে slot আগে থেকে seeded হওয়া id-তে map করতে হবে)।
- `FOREIGN_KEY_CHECKS=0` শুধু benchmark script-এ; এরপর `CHECK TABLE`/count sanity চালাও।
- Script আলাদা: `npm run seed:benchmark` — demo seed (`seed:demo`) থেকে সম্পূর্ণ আলাদা।

### 10.2 EXPLAIN steps

1. Target query:
   ```sql
   EXPLAIN SELECT * FROM appointments
   WHERE doctor_id = ? AND start_time BETWEEN ? AND ? AND status = 'CONFIRMED';
   ```
2. **Before** (index ছাড়া): `type: ALL`, rows ~1M → screenshot
3. Migration দিয়ে composite index add (`idx_appt_doctor_start_status`)
4. **After:** `type: range/ref`, rows অনেক কম → screenshot
5. README-তে দুইটা পাশাপাশি + query time (`EXPLAIN ANALYZE`)

### 10.3 Demo seed (আলাদা script)

1 admin, 5 doctors (বিভিন্ন specialty), 10 patients, আগামী ৭ দিনের slots, কিছু booked appointments। Credentials README-তে।

---

## 11. Testing (Jest)

### 11.1 Test bootstrap rules (v3 — e2e আগে এগুলো ছাড়া e2e fail করবে)

- **Dedicated test DB:** `medibook_test` (`DB_DATABASE=medibook_test` in `.env.test`). Development DB কখনো touch করবে না।
- **Shared app factory:** `test/setup-e2e.ts` → `createTestApp()` returns a configured Nest app with: global prefix `api`, versioning `v1`, global exception filter, `ValidationPipe`, pino logger। **`main.ts` ও e2e দুটোই এই এক factory ব্যবহার করবে** — নাহলে e2e-তে `requestId`/`error format`/`/api/v1` prefix অনুপস্থিত থাকে।
- **Throttler override:** `NODE_ENV=test` → `THROTTLE_LIMIT=100000`, `LOGIN_THROTTLE_LIMIT=100000` (নাহলে 10 parallel request-ই rate-limit হয়ে e2e fail করবে)।
- **Queue off:** `QUEUE_ENABLED=false` → BullMQ processor/dispatcher register হবে না। `sms_outbox` rows তবুও লিখবে (assert করা যায়)।
- **Table truncate between suites:** `SET FOREIGN_KEY_CHECKS=0; TRUNCATE ...; SET FOREIGN_KEY_CHECKS=1;` (sequence reset সহ)।
- **Nest default spec delete/modify:** `nest new` এর সাথে আসা `test/app.e2e-spec.ts` (HelloWorld) মুছে ফেলো — নইলে CI প্রথম run-এ fail করবে।
- Redis e2e-এ ব্যবহার হলে একটি dedicated Redis DB index (যেমন `REDIS_DB=1`) ব্যবহার করো, যাতে dev queue-র সাথে clash না হয়।

### 11.2 Unit

- `AuthService`: login success/fail, refresh rotation, revoked token, inactive user rejected
- `AppointmentsService`: book, cancel, reschedule, slot-not-available, past slot
- `OutboxDispatcher`: pending rows dispatch, `jobId` dedupe

### 11.3 e2e

- RBAC: patient → admin endpoint = `403`
- Validation: bad payload = `400`
- Rate limit: 6th login = `429` (throttler override ব্যতীত এটা আলাদা test env-এ চালাও — e.g. dedicated limiter test)
- Auth flow: login → refresh → logout
- Pagination meta ঠিক আছে
- Error format-এ `requestId` আছে, header `X-Request-Id`-এর সাথে মিলছে
- **Concurrency:** 10 parallel `POST /appointments` একই slot-এ → exactly **1 × 201, 9 × 409**
- Cancel → slot আবার bookable
- Reschedule success + reschedule to taken slot = `409` আর পুরোনো booking অক্ষত
- Admin deactivate → existing refresh token rejected + login blocked
- Bulk slot overlap → `409`/validation error

---

## 12. Frontend (Next.js)

### 12.1 Auth flow

- Access token memory-তে (React context)
- Refresh token httpOnly cookie (`path='/api/v1/auth'`, cross-site deploy-এ `sameSite=none; secure`)
- **axios interceptor — single-flight refresh (v3 fix):**
  - Nটি parallel `401` হলে **একটাই** `/auth/refresh` call হবে; বাকি request-গুলো ওই promise-এ queue হবে, refresh শেষ হলে সব একসাথে original request replay করবে।
  - না হলে rotation-এর কারণে একটি refresh সফল হয়ে বাকিগুলোর token invalidate করে দেবে → session ভেঙে যাবে।
  - Refresh-ও fail করলে queue clear + redirect `/login` (retry storm বন্ধ)।
- **Session rehydration:** page load-এ app mount-এ একবার `/auth/refresh` call → memory-তে access token restore (access token refresh হলো ফাঁকা মেমোরি → সব request `401`)।
- Route protection: role-based redirect (middleware বা layout guard)

### 12.2 Pages

- `/login`, `/register`
- `/doctors`: list + specialty filter + pagination
- `/doctors/[id]`: date picker + slot grid + Book
- `/appointments`: my appointments + cancel + reschedule modal
- `/doctor`: slot management + appointment list + complete + cancel
- `/admin`: users table, stats cards, create doctor

### 12.3 UI must-haves

loading skeleton, empty state, error toast (API error message + requestId), responsive layout, form validation message।

---

## 13. Docker & CI

### 13.1 `api/Dockerfile`

multi-stage (build → slim runtime), non-root user, `npm run migration:run && node dist/main`.

### 13.2 `web/Dockerfile`

Next.js `output: 'standalone'`। **`NEXT_PUBLIC_API_URL` build arg** — Next.js client env build-time-এ bake হয়, runtime env থেকে কাজ করে না:

```yaml
build:
  args:
    NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL}
```

### 13.3 Compose details (v3 fixes)

- **MySQL:** root ছাড়া app user — `MYSQL_USER: medibook`, `MYSQL_PASSWORD: medibook` (official image support করে)। API `DB_USERNAME=medibook` ব্যবহার করবে।
- **Redis:** `command: redis-server --appendonly yes` (restart-এ queue হারাবে না)।
- **api service:** `depends_on: { mysql: { condition: service_healthy }, redis: { condition: service_healthy } }`, `init: true`, own healthcheck।
- **web service:** API healthy হওয়ার পরে start (`depends_on: api: condition: service_healthy`)।

### 13.4 Run modes

```powershell
docker compose up -d                      # শুধু MySQL + Redis (dev)
docker compose --profile app up --build   # পুরো stack: mysql + redis + api + web
```

### 13.5 GitHub Actions (`ci.yml`)

- Services: `mysql:8`, `redis:7` (health checks সহ)
- Steps: setup-node 22 (`.nvmrc`) → `npm ci` (cache: npm) → lint → unit tests → `migration:run` → e2e tests → `web` build
- `.env.test` values: `DB_HOST=127.0.0.1`, `DB_DATABASE=medibook_test`, `REDIS_HOST=127.0.0.1`, `QUEUE_ENABLED=false`
- README-তে CI badge

---

## 14. Timeline (tiered — v3, ~11h ধারণা বাতিল)

> পুরো scope single developer-এর জন্য বাস্তবে **30–45h**। ডেডলাইন strict হলে **T1 আগে ship** করো, পরে T2, সময় পেলে T3।

| Tier | Scope | Estimate |
|---|---|---|
| **T1 — ship no matter what** | compose + setup, Joi env, pino + request ID, auth + RBAC, doctors/slots, book/cancel transactions + unique backstop, pagination + error format, unit + concurrency test, README + ER diagram | **12–16h** |
| **T2 — differentiator** | reschedule, BullMQ + outbox + SMS provider, admin module + deactivation, Swagger, doctor-cancel, Next.js login→book→cancel→reschedule, Dockerfiles + full compose | **+12–16h** |
| **T3 — polish** | 1M EXPLAIN demo, CI green, frontend polish (skeleton/empty/toast), demo video, deploy | **+6–10h** |

### 14.1 Intra-day checkpoints

| Checkpoint | সময় | Condition |
|---|---|---|
| C1 | +3h | auth + RBAC কাজ করছে, `POST /appointments` 201 দিচ্ছে |
| C2 | +6h | concurrency test green (1×201 / 9×409) |
| C3 | +9h | reschedule + queue green, admin login করা যায় |
| C4 | +12h | frontend login→book→cancel কাজ করছে |
| **T1 ship line** | **~16h** | README + ER + test evidence ready |
| T2/T3 | +30h | যত সময় পাওয়া যায় |

**Checkpoint ফেললে কী হবে (আগেই ঠিক করে রাখো):** C2 ফেললে → reschedule drop, UI drop. C3 ফেললে → admin module drop. কখনোই T1 (backend core + test + README) drop করো না।

---

## 15. Setup Commands (PowerShell)

```powershell
mkdir medibook; cd medibook
git init
npm i -g @nestjs/cli
nest new api --package-manager npm
cd api
npm i @nestjs/typeorm typeorm mysql2 @nestjs/config joi
npm i @nestjs/jwt @nestjs/passport passport passport-jwt argon2 cookie-parser
npm i @nestjs/throttler@5 @nestjs/swagger helmet class-validator class-transformer
npm i @nestjs/bullmq bullmq ioredis
npm i nestjs-pino pino-http date-fns date-fns-tz
npm i -D pino-pretty @types/passport-jwt @types/cookie-parser @faker-js/faker
cd ..
npx create-next-app@latest web --ts --tailwind --app
docker compose up -d
```

**docker-compose.yml (infra, api/web পরে `profiles: [app]` দিয়ে যোগ হবে)**

```yaml
services:
  mysql:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: medibook
      MYSQL_USER: medibook          # app user — root ব্যবহার করো না
      MYSQL_PASSWORD: medibook
    ports: ["3306:3306"]
    volumes: [mysql_data:/var/lib/mysql]
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-proot"]
      interval: 5s
      retries: 10
  redis:
    image: redis:7
    command: redis-server --appendonly yes
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 10
volumes:
  mysql_data:
```

---

## 16. Out of Scope (v3 — deliberate, for the interview)

এগুলো এই project-এ **নেই** — scope discipline, কোনো কিছু বাদ পড়েনি:

- Payments / billing / invoice
- Video consultation (WebRTC)
- Email verification, password reset, MFA
- Chat / messaging
- Push notifications
- File/document upload (prescription, reports)
- i18n / multi-language UI
- Prometheus metrics / Sentry / OpenTelemetry
- Audit log → **v3-তে promoted to T2 scope** (কে cancel/reschedule করল — `audit_logs` table একটা, strong talking point)

---

## 17. Definition of Done

- [ ] `docker compose up` + migration + demo seed চলে
- [ ] `docker compose --profile app up --build` এ পুরো stack উঠে
- [ ] Wrong `.env` দিলে app শুরুতেই clear error দেয় (Twilio vars `console` provider-এ required নয়)
- [ ] Swagger-এ সব endpoint documented, bearer auth কাজ করে, `/api/docs` blank না (CSP ঠিক)
- [ ] Concurrency test pass (1 success / 9 conflict)
- [ ] Reschedule test pass, failure-তে পুরোনো booking অক্ষত
- [ ] Cancel → slot আবার bookable; doctor-ও cancel করতে পারে
- [ ] Admin deactivate → refresh token rejected + login blocked
- [ ] EXPLAIN before/after screenshot README-তে (1M row, recursive-CTE seed)
- [ ] Outbox → queue → SMS path; cancel/reschedule-এ job remove/replace + stale-job skip
- [ ] Logs-এ requestId আছে, password/token redacted
- [ ] Next.js থেকে login → refresh (session restore) → book → reschedule → cancel কাজ করে
- [ ] Rate limit, validation, helmet verified
- [ ] CI green (MySQL + Redis সহ, `npm ci`)
- [ ] Demo accounts: admin / doctor / patient

---

## 18. README Outline

1. One-line pitch + screenshots/GIF
2. Features
3. Architecture diagram + ER diagram (Mermaid)
4. Booking strategy: lock + unique backstop + reschedule (Section 5 summary)
5. Performance: EXPLAIN before/after
6. Queue design + transactional outbox
7. Security checklist
8. Observability (logging, request ID, health)
9. API docs link
10. Run locally (3 commands) + full Docker mode
11. Tests: how to run + coverage
12. Demo credentials, live links
13. Out of scope (একটা লাইনে — scope discipline দেখায়)

---

## 19. Optional (সময় থাকলে)

- Bull Board (queue dashboard)
- Redis caching `GET /doctors`
- Audit log (কে কী cancel/reschedule করল) — T2-তে করলে এই list থেকে remove
- Swagger থেকে typed client generate

---

## 20. Survival Rules

1. Backend আগে। Swagger দিয়ে test করো, UI-র জন্য অপেক্ষা কোরো না।
2. প্রতি block শেষে commit।
3. ৩০ মিনিটের বেশি আটকে গেলে error paste করে help নাও।
4. **T1 line (≈16h) cross করার পরেও T2 শুরু না করলে README + test evidence finalize করো** — interview-এ ওগুলোই আলোচনা হয়।
5. **Plan থেকে কোনো backend feature কাটব না; scope কাটবে T3 থেকে।** কাটতে হলে সিদ্ধান্তটা checkpoint-এ লিখে রাখো।
6. Deploy সবার শেষে। না হলে demo video-ই যথেষ্ট।
7. README আর tests-এর জন্য শেষ ঘণ্টা ready রাখো।
