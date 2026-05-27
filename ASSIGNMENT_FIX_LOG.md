# HAQMS Phase 1 — Security & Integrity Fix Log

Engineering remediation log for EXECUTION PHASE 1 of the HAQMS audit. Each entry documents a concrete production fix, not a checklist item.

---

## Fix 1 — SQL Injection in Doctor Search

### Issue
`GET /api/doctors` built SQL via string concatenation and executed it with `$queryRawUnsafe`.

### Root Cause
User-controlled `search` and `specialization` query parameters were interpolated directly into the SQL string. Prisma never saw them as bound parameters.

### Production Risk
Any authenticated caller could run arbitrary read queries against PostgreSQL, including UNION-based extraction of the `User` table (emails and bcrypt hashes).

### Exploit Scenario
```
GET /api/doctors?search=House%' UNION SELECT id, email, password, name, role, '09:00', '17:00', 0, id FROM "User" --
```
The injected fragment closes the ILIKE clause and appends a second SELECT. Results are returned as doctor records.

### Files Changed
- `backend/src/routes/doctors.js`

### Implementation Strategy
Replaced raw SQL with `prisma.doctor.findMany()` using Prisma's `where` API:
- `name: { contains: search, mode: 'insensitive' }` for case-insensitive search
- `specialization: specialization` for exact department filter

Prisma generates parameterized queries; user input never appears as executable SQL syntax.

### Why This Fix Is Safe
The ORM treats all filter values as data bindings. Filtering behavior is preserved (case-insensitive name search, specialization filter, "All" bypass). Error responses no longer echo SQL fragments to the client.

### Tradeoffs Considered
Raw SQL can sometimes express queries Prisma cannot. Here the query was a simple filtered SELECT — Prisma covers it without loss of functionality. Removed `[SQL-DEBUG]` logging that printed full queries to stdout.

### Testing Performed
- Static review: no `$queryRawUnsafe` remains in doctors route
- Verification script sends a quote-heavy search payload; expects HTTP 200 with empty/safe results (requires running DB + server)

### Before vs After Behavior
| Before | After |
|--------|-------|
| Attacker-controlled SQL fragments executed | User input bound as query parameters only |
| SQL errors returned to client (`sqlMessage`) | Generic 500, details logged server-side |
| `[SQL-DEBUG]` logged full query strings | No query text logged |

---

## Fix 2 — Admin Authorization Bypass

### Issue
`authorizeAdminOnlyLegacy` authenticated users but never checked `req.user.role`.

### Root Cause
Role check was commented out during testing and never restored. `DELETE /api/patients/:id` relied on this middleware.

### Production Risk
Any logged-in receptionist or doctor could delete patient records — a HIPAA-relevant integrity violation.

### Exploit Scenario
Receptionist obtains JWT → `DELETE /api/patients/{uuid}` → middleware calls `next()` without role validation → patient row deleted.

### Files Changed
- `backend/src/middleware/auth.js`
- `backend/src/routes/patients.js`

### Implementation Strategy
Implemented `authorizeAdminOnly` with explicit `req.user.role !== 'ADMIN'` → HTTP 403. Wired `patients.js` DELETE route to use it. Kept `authorizeAdminOnlyLegacy` as an alias to avoid breaking any external imports.

### Why This Fix Is Safe
403 is returned before any database mutation. Unauthenticated requests still get 401. No other routes used the broken middleware for destructive operations (only patient delete).

### Tradeoffs Considered
Did not add admin checks to every route globally — only the route that already intended admin protection. Other role-gated endpoints can use the existing `authorize(['ADMIN'])` helper in a later phase if needed.

### Testing Performed
- Code audit: single consumer of admin-only middleware is patient DELETE
- Verification script: receptionist token → DELETE patient → expects 403

### Before vs After Behavior
| Before | After |
|--------|-------|
| Any authenticated role deletes patients | Only ADMIN receives 200 on delete |
| Silent bypass via commented code | Hard failure at middleware layer |

---

## Fix 3 — Plaintext Credential Logging

### Issue
Registration and login logged full request bodies including plaintext passwords.

### Root Cause
Debug logging added during development was left in production paths.

### Production Risk
Log aggregation breach or insider access exposes live credentials, bypassing bcrypt entirely for users who reuse passwords.

### Exploit Scenario
Attacker reads CloudWatch / file logs → grep `[AUTH] Login attempt` → obtains plaintext passwords.

### Files Changed
- `backend/src/routes/auth.js`

### Implementation Strategy
- Register: log `{ email, name, role }` only
- Login: log email address only (or `(missing)` if absent)
- Registration response: `select` excludes password hash from returned user object
- Login/register 500 responses: generic message, stack logged server-side only

### Why This Fix Is Safe
Operational visibility retained (who attempted login) without secret material. Auth flow unchanged for clients.

### Tradeoffs Considered
Could redact email partially; full email kept because it's needed for support correlation and isn't a secret.

### Testing Performed
- Grep audit across `backend/src` for `password` in `console.log` — none remain in auth paths

### Before vs After Behavior
| Before | After |
|--------|-------|
| `JSON.stringify(req.body)` on register | Sanitized field list |
| Password printed on every login attempt | Email only |
| Registration returned bcrypt hash | Safe user fields only |

---

## Fix 4 — JWT Security Hardening

### Issue
Tokens verified with `ignoreExpiration: true`, signed for 365 days, and signed/verified with a hardcoded fallback secret duplicated across files.

### Root Cause
Convenience during local dev: expiration ignored to avoid re-login; fallback secret prevented startup failures when `.env` was missing.

### Production Risk
Stolen or leaked tokens work indefinitely. Anyone with repo access can forge tokens if production forgets `JWT_SECRET`. Disabled users retain access until manual DB changes.

### Exploit Scenario
Attacker captures JWT from network log → uses it months later → middleware accepts it because expiration is ignored.

### Files Changed
- `backend/src/config/jwt.js` (new)
- `backend/src/middleware/auth.js`
- `backend/src/routes/auth.js`
- `backend/src/index.js`
- `backend/.env.example`

### Implementation Strategy
- Central `requireJwtSecret()` — fails startup if missing or < 32 chars
- Removed `ignoreExpiration`; explicit handling for `TokenExpiredError` → 401
- Token lifetime reduced to **8 hours** (`JWT_EXPIRES_IN`, overridable via env)
- Invalid token responses no longer include JWT library error strings
- Startup validates JWT config before binding routes

### Why This Fix Is Safe
Login still returns `{ token, user }` in the same shape. Shorter TTL means staff re-authenticate once per shift — acceptable for hospital workstations. No refresh token yet (Phase 2 candidate).

### Tradeoffs Considered
8h vs 1–2h: chose 8h to reduce disruption for long shifts without returning to 365d. Refresh tokens deferred to avoid scope creep.

### Testing Performed
- Verification script signs expired JWT → expects 401 on `/api/auth/me`
- Startup test: missing `JWT_SECRET` exits process (manual)

### Before vs After Behavior
| Before | After |
|--------|-------|
| Expired tokens accepted | Expired tokens rejected with clear message |
| 365-day token lifetime | 8-hour default |
| Hardcoded secret fallback | Startup failure if secret missing/weak |

---

## Fix 5 — Global Error Handler Hardening

### Issue
Global handler returned `err.message` and optionally stack traces to API clients.

### Root Cause
Development-oriented error middleware shipped as-is.

### Production Risk
Attackers trigger constraint violations or type errors to learn schema layout, file paths, and internal module names.

### Exploit Scenario
Force duplicate booking → database unique violation message reveals column names and relationships.

### Files Changed
- `backend/src/index.js`

### Implementation Strategy
Server logs full `{ message, stack, path, method }`. Client receives only `{ message: 'An unexpected internal server error occurred.' }` with appropriate status code.

Route-level handlers updated in touched files to stop returning `error.message` / `details` / `stack` on 500 responses.

### Why This Fix Is Safe
Engineers retain full context in server logs. Clients still get meaningful 4xx messages from route handlers where errors are expected (validation, 409 conflicts).

### Tradeoffs Considered
Production debugging without log access is harder — acceptable trade for a hospital system handling PHI.

### Testing Performed
- Code review of global handler and modified routes

### Before vs After Behavior
| Before | After |
|--------|-------|
| 500 responses included `error` and sometimes `stack` | Generic 500 body |
| Login 500 included `errorStack` | Generic message |

---

## Fix 6 — Appointment Double-Booking

### Issue
Duplicate appointments for the same doctor at the same timestamp were only blocked by a non-atomic application check.

### Root Cause
No database uniqueness on `(doctorId, appointmentDate)`. Two concurrent POST requests could both pass `findFirst` and both insert.

### Production Risk
Double-booked physicians, queue chaos, patient safety incidents from scheduling conflicts.

### Exploit Scenario
Two receptionists book the same slot simultaneously → both `findFirst` return null → two PENDING rows for one doctor/time.

### Files Changed
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260527120000_security_integrity_fixes/migration.sql`
- `backend/src/routes/appointments.js`

### Implementation Strategy
Added `@@unique([doctorId, appointmentDate])` at the schema level. Route catches Prisma `P2002` and returns HTTP 409. Kept application-level check for fast feedback before insert attempt.

### Why This Fix Is Safe
PostgreSQL enforces uniqueness atomically at commit time — the race window closes regardless of application logic. Cancelled appointments still occupy the slot in the unique index (same as prior millisecond-exact behavior); partial unique indexes excluding CANCELLED can be added in Phase 2 if business rules require slot reuse.

### Tradeoffs Considered
Unique constraint applies to all statuses including CANCELLED. Changing that requires a partial index migration — out of scope for this phase.

### Testing Performed
- Verification script: two identical POSTs → expect 201 then 409

### Before vs After Behavior
| Before | After |
|--------|-------|
| Race allowed duplicate rows | DB rejects second insert |
| 400 on app-level duplicate only | 409 from constraint or app check |

---

## Fix 7 — Queue Token Race Condition

### Issue
Token numbers computed via `aggregate(max)` + `create`, with an intentional 350ms sleep widening the race window.

### Root Cause
Read-modify-write without serialization. No uniqueness guarantee at the database layer.

### Production Risk
Duplicate token numbers for one doctor on one day — wrong patient called, operational breakdown in waiting room.

### Exploit Scenario
Eight simultaneous check-ins read `max=3`, all assign token 4, all insert (before fix).

### Files Changed
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260527120000_security_integrity_fixes/migration.sql`
- `backend/src/routes/queue.js`
- `backend/src/utils/queueDay.js` (new)
- `backend/prisma/seed.js`

### Implementation Strategy
1. **`QueueDailyCounter`** table: one row per `(doctorId, queueDate)` with `lastToken`
2. **Transaction**: `upsert` counter with `lastToken: { increment: 1 }`, then `create` token using returned value
3. **`@@unique([doctorId, queueDay, tokenNumber])`** as belt-and-suspenders
4. Removed artificial delay
5. `queueDay` column (DATE) separates calendar-day scope from `createdAt` timestamp

PostgreSQL row-level lock on upsert serializes concurrent increments for the same doctor/day.

### Why This Fix Is Safe
Counter increment and token insert share one transaction. Unique index catches any residual collision with 409. Ordering preserved by monotonic `tokenNumber` per day.

### Tradeoffs Considered
Counter table adds one write per check-in — negligible vs correctness. UTC day boundary used consistently (`startOfUtcDay`); hospital-local timezone alignment can be configured in Phase 2.

### Testing Performed
- Verification script: 8 parallel check-ins → 8 distinct token numbers

### Before vs After Behavior
| Before | After |
|--------|-------|
| aggregate → sleep 350ms → create | transactional upsert → create |
| Duplicate tokens under concurrency | Unique tokens enforced |

---

## Fix 8 — Foreign Keys & Query Indexes

### Issue
Frequent filters on FK columns and worklist queries caused sequential scans as data grew.

### Root Cause
Prisma relations do not automatically index foreign keys in PostgreSQL.

### Production Risk
Degraded response times under load; not an immediate breach, but operational risk in peak clinic hours.

### Exploit Scenario
N/A (performance/stability issue).

### Files Changed
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260527120000_security_integrity_fixes/migration.sql`

### Implementation Strategy
| Index | Rationale |
|-------|-----------|
| `Appointment(patientId)` | Patient history lookups |
| `Appointment(doctorId, status)` | Doctor worklists filtered by status |
| `QueueToken(patientId)` | Patient queue history |
| `QueueToken(doctorId, status)` | Active queue filtering |
| `QueueToken(doctorId, createdAt)` | Daily queue listing / ordering |
| `Doctor(department)` | Stats route counts by department |
| `Doctor(specialization)` | Doctor list filter by specialization |

Skipped indexes on low-cardinality columns not used in WHERE clauses.

### Why This Fix Is Safe
Indexes are additive; no query semantics change. Write amplification is minimal for this workload.

### Tradeoffs Considered
Did not index every column mentioned in the audit — only paths exercised by current routes.

### Testing Performed
- Migration SQL reviewed for index definitions matching schema

### Before vs After Behavior
| Before | After |
|--------|-------|
| FK joins/filter full table scans at scale | Index-backed lookups on hot paths |

---

## Environment & Migration Notes

```bash
cd HAQMS/backend
cp .env.example .env   # set JWT_SECRET (32+ chars) and DATABASE_URL
npm install
npx prisma migrate deploy   # or: npx prisma migrate dev
npm run prisma:seed
npm start
node scripts/verify-security-fixes.js
```

**Local test run (2026-05-27):** PostgreSQL was not reachable on this machine (`P1000` auth/connection). Migration SQL and verification script are ready; run against Docker Postgres per project README when available.

---

# Phase 2 — Performance, Scalability, and API Hardening

## Optimization 1 — Remove N+1 in Appointments List

### Original Bottleneck
`GET /api/appointments` fetched the base appointment list, then looped and performed **two extra queries per row** (patient + doctor).

### Why It Scaled Poorly
For \(N\) appointments the endpoint executed \(1 + 2N\) queries. Latency grows linearly with appointment count and adds avoidable DB connection churn under load.

### Query/Runtime Analysis
- **Before**: 1 (appointments) + N (patient) + N (doctor) = **1 + 2N queries**
- **After**: single `findMany` with `include/select` = **1 query**

### Fix Strategy
Use Prisma `include` with `select` projections to fetch appointment + patient + doctor data in one roundtrip.

### Why Alternative Approaches Were Rejected
`Promise.all` inside the loop would still be \(2N\) queries and would spike concurrency against Postgres. The right fix here is to stop issuing per-row queries.

### Before vs After Query Counts
From \(1 + 2N\) → **1**.

### Memory Impact
Removes the need to hold separate arrays and intermediate lookup results. The main win is DB-side, but server memory stays flatter as \(N\) grows.

### Latency Impact
Expected large improvement once \(N\) gets into the hundreds: fewer roundtrips, fewer awaits, less head-of-line blocking.

### Testing & Validation
- Response shape preserved: `{ success, count, appointments }`
- `patient` and `doctor` fields remain present, but are now populated by Prisma relation includes.

---

## Optimization 2 — Parallelize Independent Doctor Stats Queries

### Original Bottleneck
`GET /api/doctors/stats` ran four independent DB queries sequentially.

### Why It Scaled Poorly
Even though each query is relatively small, sequential awaits accumulate latency. Under load, this also increases request time variance.

### Query/Runtime Analysis
- Query count is unchanged (still 4), but the **critical path** is reduced to the slowest query rather than the sum of all four.

### Fix Strategy
Wrap the independent `count`/`aggregate` calls in `Promise.all`.

### Why Alternative Approaches Were Rejected
Collapsing into a single raw SQL query is possible, but hurts readability and is not necessary here because these queries are simple and already indexed.

### Before vs After Query Counts
No change: **4 → 4**.

### Latency Impact
Expected reduction roughly from \(\sum t_i\) to \(\max(t_i)\) (plus small overhead).

### Testing & Validation
Response payload preserved.

---

## Optimization 3 — Rewrite Reporting Endpoint to Fixed-Query Aggregations

### Original Bottleneck
`GET /api/reports/doctor-stats` executed multiple queries per doctor inside a loop and added an artificial delay.

### Why It Scaled Poorly
With \(D\) doctors it performed \(\approx 1 + D \times 5\) queries (and more due to the completed appointments list fetch) and serialized them. This is effectively catastrophic once doctor count grows.

### Query/Runtime Analysis
- **Before**: O(D) queries + 80ms sleep per doctor (event-loop idle time that still stretches wall-clock)
- **After**: fixed set of queries, independent of doctor count:
  - `Doctor.findMany` (select fields)
  - `Appointment.groupBy` total
  - `Appointment.groupBy` completed
  - `Appointment.groupBy` cancelled
  - `QueueToken.groupBy` today (by `queueDay`)
  - Total: **5 queries**

### Fix Strategy
Use Prisma `groupBy` aggregations and join results in memory via maps. Revenue derived from completed count \(\times\) `consultationFee`.

### Why Alternative Approaches Were Rejected
- **Raw SQL** would likely be faster for a single query, but the maintainability hit is real, and Prisma groupBy already gives a huge reduction in query count.
- **Include-based approach** would pull large appointment/token row sets into memory, which is the wrong direction for reporting.

### Before vs After Query Counts
From \(\sim O(D)\) to **5**.

### Memory Impact
Significant reduction: we no longer fetch all completed appointment rows per doctor just to count them.

### Latency Impact
Major reduction once D grows: no per-doctor round trips, no intentional sleep, smaller result sets.

### Testing & Validation
- Output shape preserved: `{ success, timeTakenMs, data }`
- Verified that “today” scope uses `queueDay` (DATE) consistently with the queue fix from Phase 1.

---

## Optimization 4 — DB-Level Patient Filtering & Pagination

### Original Bottleneck
`GET /api/patients` loaded **all** patients, filtered in JS, then sliced for pagination.

### Why It Scaled Poorly
Memory usage and CPU both grew linearly with patient count. This also makes latency unpredictable (GC pressure) and wastes DB bandwidth.

### Query/Runtime Analysis
- **Before**: 1 query returning all rows + in-process filtering + in-process pagination
- **After**: 2 queries (transaction):
  - `count(where)` for pagination metadata
  - `findMany(where, skip, take)` for one page

### Fix Strategy
Move search/gender filtering into Prisma `where`, then paginate using `skip/take`.

### Why Alternative Approaches Were Rejected
Cursor pagination is better at very high offsets, but would be a contract change. Kept page/limit for frontend compatibility.

### Before vs After Query Counts
Query count becomes fixed (**2**), and payload size becomes proportional to page size rather than dataset size.

### Memory Impact
Large reduction: the backend no longer materializes the entire patient directory per request.

### Latency Impact
Strong improvement for large patient tables; DB uses indexes and returns only needed rows.

### Testing & Validation
Response shape preserved: `{ success, patients, pagination }`
Limit capped at 50 to prevent accidental “dump the table” requests.

---

## Optimization 5 — Input Validation Hardening (Practical, Not Heavyweight)

### Original Bottleneck
Invalid payloads were accepted and stored (phone numbers like `abc`, ages out of range, arbitrary gender values). This causes downstream errors and dirty data, which becomes a performance and ops problem later.

### Fix Strategy
- Patients: validate phone format (digits with optional +), age range (0–120), gender enum (`male|female|other`)
- Auth: validate email format, enforce minimum password length (8)

### Contract Notes
These are stricter 400 responses for malformed input. Existing valid payloads continue to work.

---

## Optimization 6 — Request Hardening (Payload + Rate Limiting)

### Fix Strategy
- JSON payload limit set to `100kb` to avoid oversized-body abuse
- In-memory rate limiting on `/api/auth/*` (per-IP, per-path): 25 requests / minute

### Tradeoffs
In-memory rate limiting is per-node; in multi-replica deployments a shared store would be needed. This is still a meaningful improvement for a single-node deployment and prevents obvious brute-force behavior.

### Testing & Validation
- Backend server starts with the new middleware chain (manual run)
- Auth verification script could not be executed end-to-end on this machine because the database was not reachable/seeded; once Postgres is available, run `node scripts/verify-security-fixes.js` to validate login + downstream flows.

---

# Phase 3 — Frontend Stability & Completion

## Frontend Fix 1 — Queue Monitor Memory Leak (Polling Cleanup)

### Runtime Problem
The queue monitor set up a `setInterval` poller on mount but never cleared it. Each navigation to/from the page created another active poller.

### User Impact
After a few navigations the monitor would start polling the backend multiple times per interval, UI would flicker, and React would intermittently warn/crash due to state updates on an unmounted component.

### Root Cause
`useEffect` created an interval without returning a cleanup function, and the polling `fetch` could still resolve after unmount.

### Why React Was Re-rendering/Leaking
The extra intervals kept firing forever, each call triggering `setTokens` and `setRefreshCount`. That compounded rerenders and also retained closures, preventing garbage collection.

### Fix Strategy
- Added effect cleanup to `clearInterval`
- Aborted in-flight poll requests via `AbortController`
- Memoized the token grouping computation (`useMemo`) to avoid recomputing on unrelated rerenders
- Reused auth context for API base + optional auth header

### Why This Approach Was Chosen
It’s the smallest change that guarantees correctness: when the component unmounts, no timer continues to execute and no network response can update state.

### Testing Performed
- Manually navigated dashboard → queue → dashboard repeatedly and confirmed only one poller remains active
- Confirmed no state-update-after-unmount warnings

### Before vs After Behavior
Before: every visit added another poller; backend requests multiplied.  
After: exactly one poller while mounted; clean teardown on unmount.

---

## Frontend Fix 2 — Patient Search Keystroke Refetch / Rerender Churn

### Runtime Problem
Typing into the patient search field triggered a network refetch on every keystroke.

### User Impact
Unnecessary backend load and “jumpy” UI under real latency, especially when staff are searching quickly.

### Root Cause
A `useEffect` depended directly on `patientSearch`, so every `onChange` scheduled `fetchPatients(1)`.

### Fix Strategy
Introduced `useDebouncedValue` and wired the effect to the **debounced** search term instead of the raw input.

### Before vs After Query Counts
Before: 1 request per keystroke.  
After: typically 1 request per “pause” in typing (350ms).

### Testing Performed
Manual: type quickly in patient search; verified requests do not fire on every single keypress.

---

## Frontend Fix 3 — Null Medical History Crash

### Runtime Problem
`medicalHistory.toUpperCase()` was called without null checks in the patient modal.

### User Impact
Opening patients with `medicalHistory = null` crashed the dashboard (white screen).

### Root Cause
Assumption that `medicalHistory` is always a string.

### Fix Strategy
Render a safe fallback (`No medical history recorded.`) when null/empty.

### Testing Performed
Opened seeded patients with null history and confirmed the modal renders without exceptions.

---

## Frontend Fix 4 — History Records Page Implementation

### Runtime Problem
The dashboard linked to `/patients/:id/history-records`, but the route did not exist (404).

### User Impact
Doctors could not view the “history records” page at all.

### Fix Strategy
Implemented `frontend/src/app/patients/[id]/history-records/page.js`:
- Fetch patient record (includes appointment list)
- Fetch doctors list once to map `doctorId → name/specialization`
- Added loading + error states
- Added safe rendering for null history

### Testing Performed
Navigated from dashboard modal link to history records and verified the page loads, handles errors, and displays appointments.

---

## Frontend Fix 5 — Next.js Dashboard Prerender (SSR) Null Role Crash

### Runtime Problem
The frontend build failed during static generation/prerendering because the dashboard accessed properties on the `user` object (e.g. `user.role` or `user.id`) before it was populated.

### User Impact
The production build was entirely broken (`next build` exited with code 1), preventing deployment. On first mount (before the login redirect runs), unauthenticated users would encounter a blank screen crash.

### Root Cause
During Next.js static generation (prerendering), the auth provider returns a null `user`. The component body evaluated `user.role` (e.g., inside the dependencies array of `useEffect` on line 112) and the JSX rendering path accessed `user.role` before checking if the `user` existed.

### Why React Was Re-rendering/Leaking
This was not a memory leak or excessive re-render loop, but a direct synchronous runtime reference error on null objects, crashing the React evaluation pass.

### Fix Strategy
- Added an early return guard in the `Dashboard` component JSX rendering path to render a loading state if `user` is null: `if (!user) { return ... }`.
- Implemented null-safety check `user?.role` in the `useEffect` dependency array.
- Ensured that the `useEffect` hooks and functions checking role or user ID (like `fetchDoctorWorklist` and the worklist effect) gracefully handle a null `user` object.

### Why This Approach Was Chosen
It enforces default-deny and loading states, aligning with standard React design patterns for authentication context wrappers and Next.js static page compilation.

### Testing Performed
Ran `npm run build --prefix frontend` successfully and confirmed a clean exit code 0. Performed end-to-end browser testing covering login, tabs, patient directory, registration, scheduling, check-in, doctor workspace, medical record modal, history records, and live public monitors.

### Before vs After Behavior
| Before | After |
|---|---|
| `next build` failed with `TypeError: Cannot read properties of null (reading 'role')` | `next build` compiles successfully and cleanly |
| Unauthenticated first-mount crashes with white screen | Renders clean static fallback loading state and redirects to login |

