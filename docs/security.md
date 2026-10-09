# Security

## Exposure model

Hermes Mission Control is designed as a local, read-only observation surface. The bootstrap binds a single TCP listener to `127.0.0.1`; runtime configuration rejects any other application bind address.

**Do not expose the application listener directly to the public Internet or bind it to a non-loopback interface.** Do not use port-forwarding, container port publication, or a proxy configuration that accidentally bypasses authentication. Loopback reduces network reachability but is not an authentication boundary: other processes running on the host may be able to connect.

If remote access is required, keep Mission Control on loopback and put a deliberately configured security boundary in front of it, such as a hardened reverse proxy reached through a private network or authenticated tunnel. Terminate HTTPS there, use a trusted certificate, restrict allowed users/networks, preserve the application's Basic authentication unless there is a reviewed replacement, and apply firewall controls. Test that the backend port remains unreachable externally.

## Basic authentication

Every request passes through the global Basic authentication hook, including health, observations, and static frontend assets. Runtime startup requires:

- `HMC_BASIC_USERNAME`: 1–64 characters from `A-Z`, `a-z`, `0-9`, `.`, `_`, or `-`.
- `HMC_BASIC_PASSWORD_HASH`: the exact versioned scrypt encoding accepted by the configured policy.

The application never accepts a plaintext password in configuration. Password verification uses scrypt (`N=32768`, `r=8`, `p=1`, 16-byte salt, 32-byte derived key), compares derived keys in constant time, and compares SHA-256 username digests in constant time. Authorization and cookie headers plus common password fields are redacted from application logs.

Basic authentication only encodes credentials; it does **not** encrypt them. The built-in loopback listener is plain HTTP. Never send Basic credentials over an untrusted plaintext connection. Use HTTPS at the reverse proxy/tunnel boundary and protect proxy-to-backend connectivity on the same trusted host.

Authentication failures are held in a single in-memory limiter for the process: five retained failures in a five-minute window lead to `429`, failures after the third incur bounded delay, and a successful authentication clears the retained failures. This is intentionally simple, but has important limitations:

- it is global, not per account or client;
- state is lost on restart and is not shared across instances;
- a successful login clears failures from other attempts;
- it is not a substitute for proxy rate limiting, monitoring, account policy, or network access control;
- because verification is deliberately expensive, unauthenticated request floods can consume resources.

Use a strong unique password, limit who can read the hash-bearing environment, rate-limit at the outer boundary, and rotate credentials according to local policy.

## Read-only HTTP boundary

The public API implements reads only. Mutation methods on API routes return `405`, and response bodies are schema-validated before publication. Security headers include:

- `Cache-Control: no-store`
- a same-origin Content Security Policy with scripts/styles/connections/images/fonts restricted to self
- `frame-ancestors 'none'` and `form-action 'none'`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- disabled camera, microphone, and geolocation permissions

Server-identifying headers are removed. Public errors are sanitized, and audit entries contain only method, path without query, and status code.

“Read-only” describes the application routes and shipped observation adapters. It is not an operating-system sandbox and does not prevent a compromised process or dependency from using the service account's permissions.

## Local data boundary

Configure only dedicated, least-privilege local paths. Production path values are server environment settings and are never accepted from an HTTP request. Snapshot consumers require private ownership/modes, reject symlinks, perform bounded reads, compare file identity around the read, and reject JSON/schema/semantic violations. Other local adapters also constrain their approved roots and read sizes according to their source contracts.

Run the service and trusted snapshot producer under an appropriately isolated account. Grant access only to the exact metadata, profile state, schemas, snapshots, and build artifacts needed. Avoid broad home-directory or credential-store access. Keep snapshot directories private (`0700`) and files private (`0600`) under the runtime UID/GID, as required by the adapters.

Only sanitized aggregate projections are intended for the API. Do not place credentials, personal records, free-form notes, raw logs, or unnecessary identifiers into snapshots. Schemas and projection are safeguards, not permission to feed untrusted sensitive files to the service.

## Fail-closed behavior

The application refuses startup when required authentication values, password-hash policy, frontend build assets, or required absolute path configuration is invalid/missing. Path syntax is checked at composition time, but most source files, permissions, schemas, and snapshot contents are exercised when a request invokes the adapter; those failures become explicit unknown/unavailable states. At request time it also reports missing providers and invalid observation contracts rather than fabricating health. The browser separately fails closed on an invalid API response.

Source failures are isolated per slot by `ObservationService`, so an aggregate may return `200` while one or more sources are `UNKNOWN` or `UNAVAILABLE`. Therefore HTTP success and `/health` status `UP` prove only that the application answered; they do not prove source health, snapshot freshness, job execution, delivery, or upstream correctness. Monitor the observation states, not only the HTTP status.

## Safe-runner warning

The safe process runner is bounded but not sandboxed, and it is not wired to HTTP or production observation collection. It must remain inaccessible to arbitrary HTTP input. Frozen capability IDs, time/output bounds, environment reduction, and `shell: false` reduce risk but do not remove the child executable's own network, filesystem, update, credential, or side-effect behavior. Raw successful output may be sensitive and must never be returned directly.

## Remaining limitations

- There is no built-in TLS termination, external identity provider, role-based authorization, multi-user audit identity, secret manager integration, or distributed rate limiter.
- The application has one Basic-auth account and one process-wide failure limiter.
- The local listener is HTTP and depends on host security.
- Snapshot producers and their trust controls are outside this repository.
- Filesystem checks reduce path/race risk but do not defend against a hostile process with the same UID that can replace files and permissions.
- Dependency and host hardening, patching, backups, log retention, firewall policy, proxy configuration, and incident response remain operator responsibilities.
