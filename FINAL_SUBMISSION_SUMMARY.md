# HAQMS — Final Submission Summary

This repository was remediated in three execution phases (security/integrity, backend performance, frontend stabilization) with an emphasis on production safety and operational reliability for a healthcare workflow.

## Major issues fixed

### Security & integrity (Phase 1)
- Removed SQL injection in doctor search by replacing raw unsafe SQL with parameterized Prisma queries.
- Enforced admin-only authorization where it was previously bypassable.
- Removed plaintext credential logging from auth flows.
- Hardened JWT verification (no ignored expiration, no hardcoded fallback secret, validated env configuration, reduced default TTL).
- Hardened global error handling to prevent stack trace/internal detail leakage.
- Enforced appointment uniqueness at the DB layer to prevent double booking.
- Made queue token generation concurrency-safe using transactional counters + DB uniqueness guarantees.
- Added targeted indexes for common query paths.

### Backend performance (Phase 2)
- Eliminated N+1 queries in appointments list by fetching relations via Prisma `include/select`.
- Parallelized independent doctor stats aggregation calls via `Promise.all`.
- Rewrote the reporting endpoint from per-doctor nested queries to fixed-count `groupBy` aggregations.
- Moved patient filtering + pagination into the database; capped page size to prevent accidental “full table” reads.
- Added practical validation for common data quality issues (phone/age/gender; auth email/password basics).
- Added request hardening: JSON body size cap and in-memory auth rate limiting.

### Frontend stability & completion (Phase 3)
- Fixed queue monitor memory leak by cleaning up intervals and aborting in-flight poll requests on unmount.
- Reduced search-driven rerender/refetch churn by debouncing patient search.
- Fixed crash when patient medical history is null by rendering safe fallbacks.
- Implemented missing History Records page (`/patients/:id/history-records`) with loading/error states and reliable rendering.
- Fixed Next.js build-time prerender and runtime first-mount crash on `/dashboard` by introducing a null check/early return loading state for the user object, and securing role checking inside hook dependency arrays.

## Engineering priorities and rationale
- **Correctness first**: integrity constraints and transactional operations were prioritized over “clever” app-level checks.
- **Fail safe**: auth and error handling changed to default-deny behavior and production-safe responses.
- **Fixed-query reporting**: reporting endpoints were made to scale with data volume by keeping query count constant.
- **Frontend stability**: eliminated leaks and null crashes before any cosmetic polish.

## Performance gains (high level)
- Appointments list: from \(1 + 2N\) queries to 1 query.
- Reports endpoint: from O(doctors) query behavior + artificial delay to a fixed 5-query approach.
- Patients listing: from in-memory filtering/pagination over full datasets to DB-side pagination with bounded page sizes.

## Remaining limitations (known)
- In-memory auth rate limiting is per-node; horizontally scaled deployments should move to a shared store.
- History Records page uses a “patient record + doctors list” join in the client; a dedicated backend patient-history endpoint would be cleaner long-term.
- Frontend still uses a hardcoded API base URL via auth context; making this environment-configurable is recommended.

## Deployment notes
- Requires PostgreSQL and Prisma migrations applied.
- Backend expects `JWT_SECRET` to be set (32+ chars).
- For local dev: run DB migration + seed, then start backend (5000) and frontend (3000).

## Architectural observations
- Prisma is a good fit for this system; correctness hinges on DB constraints and avoiding raw SQL.
- App Router structure is minimal; adding only required routes kept the frontend maintainable without a large refactor.

