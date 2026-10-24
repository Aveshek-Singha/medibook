# Production readiness review

**Status: technical release candidate; not approved for live patient use yet.**

The code and local integration path have been hardened and verified, but the workspace has no selected production host, real provider credentials, operator identity, retention policy, or recovery objective. Those are deployment and product decisions that cannot be safely guessed from the codebase.

## Engineering controls in place

| Area                    | Current state                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API dependency security | Patched the NestJS family, TypeORM, MySQL driver and affected transitive packages. `pnpm audit` and `pnpm peers check` are release checks.                                                                                |
| Startup configuration   | `NODE_ENV` must be explicit. Production requires separate strong JWT keys, strong database and Redis credentials, database TLS, Redis TLS, HTTPS CORS origins, a queue worker, Twilio SMS and schema synchronization off. |
| Database release safety | Startup and the migration CLI use validated configuration. Migrations remain a separate reviewed step; production schema synchronization is rejected.                                                                     |
| Rate limiting           | Shared Redis is used across instances. Production fails closed if it cannot apply the shared rate limit; local development and tests retain an in-memory fallback.                                                        |
| Readiness and liveness  | `/api/health/live` checks only process liveness. `/api/health/ready` and the compatibility `/api/health` check MySQL, Redis and the SMS worker; dependency failure returns HTTP 503.                                      |
| API docs                | Swagger is enabled in development and tests, disabled in production, and does not persist authorization tokens.                                                                                                           |
| Frontend API target     | Production builds require an absolute HTTPS `NEXT_PUBLIC_API_URL` ending in `/api/v1`; no production build silently targets localhost.                                                                                    |
| Secret files            | `.env`, `.env.local`, and `.env.test` are ignored. Safe templates are provided for development and tests.                                                                                                                 |
| Continuous integration  | `.github/workflows/ci.yml` runs dependency audit, lint, builds, unit/e2e suites, migrations, schema drift checks and frontend checks. It does not deploy.                                                                 |

## Required before a real-user launch

1. **Choose and configure the hosting topology.** Set the real HTTPS frontend origin, API URL, trusted proxy hop count, MySQL/Redis hosts and TLS CA values. Use a secret manager for JWT, database, Redis and Twilio credentials. Keep MySQL and Redis private and restrict the API ingress to HTTPS.
2. **Approve patient-facing legal and privacy material.** Provide the actual operator/legal entity, contact address, applicable jurisdictions, privacy notice, terms, health-data consent, retention/deletion schedule, export process and incident contact. The repository cannot authoritatively invent these facts; obtain jurisdiction-specific review before collecting patient records.
3. **Choose the identity and clinical onboarding policy.** Email verification, password recovery, MFA, verified clinician credentials and secure clinician invitations are not implemented in the product plan. Decide which are launch requirements and add the selected delivery/identity integrations before opening registration to the public.
4. **Verify messaging consent and operations.** Confirm patient SMS consent and opt-out wording, sender registration and regional delivery, then test Twilio production credentials, delivery receipts, queue retries, and support procedures. Console SMS is rejected in production.
5. **Set reliability objectives.** Define RPO/RTO, encrypted database backups, point-in-time recovery, Redis persistence expectations, retention of security audit logs, uptime/error/queue-lag alerts and on-call ownership. Run a restore drill and verify it before launch.
6. **Run deployment-specific security and capacity reviews.** Apply migrations against a staging copy, verify rollback/forward recovery, run load tests at the intended clinic/patient volume, and perform external penetration testing. No cloud deployment, restore drill, external penetration test, or million-row benchmark has been completed in this workspace.

## Release verification

The CI workflow is the repeatable code gate. Before deploying a release, also run the staging and operational checks in the API README and record the migration version, backup timestamp, rollback plan and release owner. A green CI run alone does not satisfy the launch gates above.
