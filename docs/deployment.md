# Deployment

This is a generic deployment guide. It intentionally does not publish a personal service-manager unit, machine paths, account names, operational IDs, snapshot contents, or credentials. Translate the requirements into your own reviewed supervisor/container/orchestrator configuration without changing the loopback-only exposure model.

## Requirements

- Node.js `>=24 <25`
- npm `>=11 <12`
- a dedicated, unprivileged runtime identity
- a trusted local Hermes installation/profile source compatible with the shipped adapters
- three trusted, external snapshot producers
- private storage for snapshots and authentication configuration
- a reverse proxy or authenticated tunnel with HTTPS if access beyond the host is needed

The project has no database and no snapshot producer. Its production server serves the built React assets and collects local observations on each API request.

## Build and verify

From a clean checkout:

```bash
npm ci
npm run quality
```

`npm run quality` performs strict type checks, lint, tests, production server/web builds, and a demo build. For a build-only pipeline use `npm run build`, but do not skip tests in a release pipeline. The runtime entry point created by the build is started by `npm run start:local`.

Keep source/build ownership separate from any account that can modify untrusted content. Deploy immutable build output where practical.

## Create the Basic password hash

Build first, then use the repository's scrypt implementation. The following reads the password from the terminal and sends it over stdin rather than placing it in command arguments:

```bash
read -r -s -p 'Mission Control password: ' HMC_PASSWORD; printf '\n'
printf '%s' "$HMC_PASSWORD" | node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { encodePasswordHash } from "./dist/server/security/scrypt-password.js";
  process.stdout.write(await encodePasswordHash(readFileSync(0, "utf8")) + "\n");
'
unset HMC_PASSWORD
```

Store only the resulting `scrypt$v1$...` value in the runtime secret mechanism. Protect it as a credential even though it is a hash. Do not commit it, paste it into documentation, or put the plaintext password in command history, unit files, images, or environment files readable by other users.

## Runtime configuration

The production bootstrap requires all values below unless marked optional. Every filesystem path must be absolute. Values shown are placeholders, not recommended or real machine paths.

```text
HMC_BASIC_USERNAME=<approved ASCII username>
HMC_BASIC_PASSWORD_HASH=<encoded-scrypt-v1-hash>
HMC_PORT=<unprivileged port; default 3200>

HMC_HERMES_PROFILE_ROOT=<absolute profile root>
HMC_HERMES_SITE_PACKAGES_ROOT=<absolute site-packages root>
HMC_HERMES_DISTRIBUTION_METADATA_DIR=<absolute distribution metadata directory>
HMC_HERMES_SOURCE_ROOT=<absolute editable source root>
HMC_SCHEMA_ROOT=<absolute path to the deployed schemas directory>

HMC_ACCOUNTING_SNAPSHOT_PATH=<absolute path ending accounting_v2.snapshot.json>
HMC_BANK_JOURNAL_SNAPSHOT_PATH=<absolute path ending bank_journal_quality.snapshot.json>
HMC_SUBMISSION_SNAPSHOT_PATH=<absolute path ending submission_tracker.snapshot.json>

HMC_PROC_ROOT=<optional absolute proc root; defaults to /proc>
```

`HMC_PORT` must parse as an integer from 1024 through 65535. There is no environment option for the host: the bootstrap always listens on `127.0.0.1` and runtime validation permits only that address.

Do not pass secrets or paths as HTTP parameters. Do not include production values in support bundles, issue reports, logs, examples, or public configuration.

## Prepare snapshots

The consumer expects each snapshot directory **and its parent** to be owned by the runtime UID/GID with exact mode `0700`; each snapshot file must be owned by that UID/GID with exact mode `0600`. Symlinks are rejected. Each JSON file must be at most 256 KiB and pass the corresponding schema in `schemas/` plus semantic validation.

Run producers separately from the HTTP server. A safe producer pattern is:

1. derive only sanitized aggregate data;
2. validate against the repository schema and domain rules;
3. write a private temporary regular file in the destination directory;
4. flush as required by local durability policy;
5. set/check ownership and mode; and
6. atomically replace the approved filename.

Do not write a live file incrementally. The adapter detects changes around an open read and fails that observation rather than accept an inconsistent document. Producers are not supplied here, so producer correctness, scheduling, source authorization, atomicity, and monitoring remain deployment responsibilities.

## Run under a supervisor

Configure your chosen supervisor to:

- use a dedicated unprivileged identity and a fixed project working directory;
- execute `npm run start:local` (or the equivalent Node entry point) only after a successful build;
- inject secrets through the platform's protected secret facility;
- grant read access only to required build, schema, Hermes metadata/state, and snapshot locations;
- set a conservative environment and resource limits;
- capture stdout/stderr securely, because operational metadata can still be sensitive;
- send `SIGTERM` for graceful shutdown and wait for the listener to close;
- restart according to an explicit backoff policy; and
- never override the loopback bind with container/network publication.

A service manager, container manifest, and orchestration policy are environment-specific security artifacts. This repository deliberately does not provide a personalized systemd unit. Review any generated unit or manifest for filesystem access, environment disclosure, privilege boundaries, port publication, and restart loops.

Start interactively once in a controlled environment to catch fail-closed configuration errors:

```bash
npm run start:local
```

The process loads frontend assets and constructs all production adapters before listening. Missing/invalid credentials, required absolute path configuration, or build assets prevent startup. Most file existence, ownership/mode, schema-file, and snapshot-content checks occur when an authenticated observation request invokes an adapter, so complete the local API verification below before putting a proxy into service.

## Verify locally

From the same host, authenticate against loopback:

```bash
curl --fail --silent --show-error \
  --user '<username>' \
  --header 'Accept: application/json' \
  'http://127.0.0.1:<port>/api/v1/health'

curl --fail --silent --show-error \
  --user '<username>' \
  --header 'Accept: application/json' \
  'http://127.0.0.1:<port>/api/v1/observations'
```

Avoid putting a real password directly in shell history; omit it after `--user '<username>'` and let `curl` prompt, or use an approved credential mechanism. Verify all seven source slots and inspect their availability/freshness/review/error states. A `200` response or health status `UP` does not mean every source is healthy. In the shipped production composition, the profile slot remains integration pending.

Also verify from another host that the backend port cannot be reached.

## Remote access and HTTPS

For any access beyond local host use all of the following:

1. Leave Mission Control bound to `127.0.0.1`.
2. Place a reviewed reverse proxy on the same trusted host, or use an authenticated encrypted tunnel/private network.
3. Terminate TLS with a valid certificate; redirect or reject plaintext traffic.
4. Enforce strong upstream authentication and authorization, network allowlists where appropriate, request/body/time limits, and rate limiting.
5. Forward only the required paths and methods; do not create a generic process-execution endpoint.
6. Keep Basic authentication enabled unless a code-reviewed deployment explicitly replaces the application boundary.
7. Confirm proxy logs redact `Authorization` and do not retain sensitive response bodies.
8. Firewall the backend port and continuously verify there is no direct public route.

**Direct public exposure is not supported or recommended, even with Basic authentication.** The built-in listener has no TLS, Basic auth is single-user, and the in-memory limiter is not a distributed/per-client Internet-facing defense.

## Operational limitations

- No automatic browser polling or background snapshot refresh exists; users see new evidence on page load or manual refresh.
- No cache or last-known-good store is maintained by the production composition.
- No bundled backup, retention, metrics exporter, alerting, certificate automation, or secret rotation workflow exists.
- `/api/v1/health` checks application response only, not each observation source.
- Source failures can appear inside a successful aggregate response.
- Snapshot producers and Hermes compatibility validation are operator responsibilities.
- The safe Hermes process runner is not connected to production collection or HTTP and should not be exposed as a deployment feature.
