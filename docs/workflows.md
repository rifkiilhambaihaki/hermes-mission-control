# Workflows

Hermes Mission Control is a read-only, request-driven dashboard. It does not poll, cache, mutate a source, or run a background refresh loop.

## Page load and manual refresh

1. On mount, the React application calls `fetchObservations()` once.
2. The browser sends `GET /api/v1/observations` with `Accept: application/json`, same-origin credentials, and `cache: no-store`.
3. The global HTTP authentication hook checks Basic authentication before the route runs.
4. `ObservationService.collect()` invokes the configured providers concurrently, in the fixed source order, and creates a new `generated_at` timestamp.
5. Each provider reads its local source at request time. The production composition reads local Hermes metadata/state and the three configured snapshot files; it does not return a previously cached aggregate.
6. The service normalizes and projects every observation to the public DTO. The HTTP route validates the complete response contract before returning it.
7. The browser independently checks the envelope, exact source order, exact object keys, enum values, timestamps, source-specific `current` shape, and state invariants before rendering.

The **Manual Refresh** button repeats exactly that flow. It is not a command to regenerate snapshots and does not invoke a producer. A second click is ignored while a request is in flight. The footer's “No automatic polling” statement is literal.

A failed refresh replaces the rendered success state with a safe failure panel; the UI does not silently retain and present the previous aggregate as current. The user can retry manually.

## API behavior

Authenticated read routes are:

- `GET /api/v1/health`
- `GET /api/v1/observations`
- the corresponding `HEAD` routes exposed by Fastify
- same-origin static frontend assets when a frontend bundle was supplied at startup

`POST`, `PUT`, `PATCH`, and `DELETE` on the two API routes return `405` with `Allow: GET, HEAD` after authentication. Query strings must be empty. Unknown routes use a sanitized public `404`; internal and response-validation errors become sanitized `500` responses.

Authentication applies globally, including health and static assets. Depending on failure count, invalid credentials produce `401` or `429`. The browser maps `401` to `AUTH_REQUIRED`, `403`/`429` to `ACCESS_RESTRICTED`, transport and other non-success responses to `API_UNAVAILABLE`, and invalid JSON/contracts to `MALFORMED_RESPONSE`.

## Snapshot ingestion

The repository includes consumers and schemas for these fixed filenames:

- `accounting_v2.snapshot.json`
- `bank_journal_quality.snapshot.json`
- `submission_tracker.snapshot.json`

Snapshot **producers are deliberately not part of this public repository**. A deployment must supply its own trusted producer. Manual refresh only rereads whatever is already at the configured path.

For each request, a snapshot adapter:

1. verifies the configured absolute path and approved filename;
2. verifies the snapshot directory and its parent are real directories, not symlinks, owned by the running UID/GID, with mode `0700`;
3. verifies the file is a regular, non-symlink file owned by the running UID/GID, with mode `0600`;
4. rejects files over 256 KiB;
5. opens read-only with `O_NOFOLLOW` and compares device/inode/size/mtime identity before, during, and after the read;
6. parses strict JSON;
7. validates the Draft 2020-12 JSON Schema and domain semantics; and
8. rejects invalid or excessive-future timestamps, then computes freshness.

A producer should generate a complete schema-valid document in private storage, set the required ownership/modes, and publish it using an atomic replacement in the same directory. Coordinate replacement with the adapter's identity checks: a coincident replacement may intentionally fail that request rather than return a mixed read; the next manual refresh can retry.

The public API does not pass through full snapshots. The application service projects only approved source-specific fields; the three domain sources expose aggregate `summary` fields. Snapshot detail fields are not included in the API DTO.

Production freshness policy is fixed in the current composition:

- Accounting: stale after 24 hours, expired after 72 hours.
- Submission tracker: stale after 7 days, expired after 30 days.
- Bank journal: stale after 30 days, expired after 120 days.
- All three allow at most 5 minutes of future clock skew at ingestion.

Freshness reports age; it does not prove that an upstream business workflow is healthy.

## Fail-closed and uncertainty states

The system preserves uncertainty instead of converting it to success:

- An unconfigured provider becomes `UNKNOWN` / `INTEGRATION_PENDING` with no current data and no confidence.
- A provider that throws becomes `UNAVAILABLE` / `SOURCE_OBSERVATION_FAILED`.
- A returned observation that violates invariants or cannot be projected becomes `UNKNOWN` / `INVALID_OBSERVATION_CONTRACT`.
- An `UNKNOWN` snapshot has `current: null` and confidence `NONE`.
- Stale or expired current data is surfaced as `STALE`, not `AVAILABLE`.
- Invalid snapshots, unsafe paths, changed files, schema failures, and semantic failures are rejected rather than partially rendered.
- If the final aggregate fails its HTTP schema, the route returns a sanitized server error. If the browser rejects the response contract, it renders no observation cards.

The current production composition intentionally has no `HERMES_PROFILE` provider, so that slot is reported as integration pending. Gateway Adapter V1 also leaves service-manager dimensions unknown and does not prove service execution health. Scheduler data describes scheduling intent/counts only; it does not prove job execution or delivery.
