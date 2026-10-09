# Adapters

Adapters translate bounded local evidence into the domain `Observation<T>` model. They are server-side code; the frontend does not import adapters or perform filesystem/process access.

## Actual contract

There is no runtime plugin loader or open-ended source registry. `ObservationService` accepts a partial map of asynchronous providers:

```ts
type ObservationProvider = () => Promise<Observation<unknown>>;
type ObservationProviderMap = Readonly<
  Record<ObservationSourceId, ObservationProvider>
>;
```

`ObservationSourceId` is a closed set of seven IDs. The application service invokes a provider, validates generic observation invariants, validates timestamps and sanitized error codes, then applies the source-specific public projection. Adding an eighth source therefore requires coordinated changes to the service source list/projector, HTTP schema, browser validator, and UI; dropping an arbitrary provider into a directory is not sufficient.

The production composition uses narrower ports:

- Version: `read(): Promise<LocalVersionMetadataResult>`
- Gateway: `observe(request): Promise<Observation<GatewayObservationData>>`
- Scheduler: `observe(request): Promise<Observation<SchedulerData>>`
- Accounting, bank journal, and submission tracker: source-specific `observe(request)` methods returning typed observations

Descriptors can only be created from approved server configuration. Production paths come from `HMC_*` environment variables, not from request parameters.

## Concise custom adapter example

This example replaces the scheduler port while preserving the real request and observation contracts. It does not register a new source ID.

```ts
import type { SchedulerObservationRequest } from "../src/adapters/hermes-scheduler-local/index.js";
import type { LocalSchedulerAdapterPort } from "../src/infrastructure/observations/local-observation-providers.js";
import type { SchedulerData } from "../src/domain/scheduler/scheduler-observation.js";
import { createObservation, type Observation } from "../src/domain/observation/observation.js";

export class EmptySchedulerAdapter implements LocalSchedulerAdapterPort {
  async observe(
    request: SchedulerObservationRequest,
  ): Promise<Observation<SchedulerData>> {
    return createObservation({
      availability: "EMPTY",
      completeness: "EMPTY",
      freshness: "FRESH",
      reviewStatus: "NONE",
      provenance: {
        source: request.source,
        observedAt: request.observedAt,
        fetchedAt: request.fetchedAt,
      },
      confidence: { level: "HIGH", reasons: ["Validated empty source."] },
      current: {
        schedulerAvailability: "EMPTY",
        enabledJobCount: 0,
        totalJobCount: 0,
      },
      error: null,
      lastKnownGood: null,
    });
  }
}
```

Supply the instance as `schedulerAdapter` when calling `createLocalObservationService`. The caller still supplies all of the other required production adapter ports. For lower-level composition, an `ObservationService` can be created directly with a partial `providers` map; omitted fixed sources safely become `INTEGRATION_PENDING`.

A real adapter must additionally:

- accept only its approved literal `request.source`;
- return a valid `Observation<T>` and never claim confidence for `UNKNOWN`/`UNAVAILABLE`;
- use `current: null` for `UNKNOWN`/`UNAVAILABLE`, and provide a sanitized error for `UNAVAILABLE`;
- bound all input size/cardinality and reject malformed data;
- emit valid date-time provenance and stable uppercase error codes;
- avoid leaking paths, credentials, names, raw command output, or source records into error text/data; and
- make uncertainty, partial completeness, stale evidence, and review requirements explicit.

Returning the TypeScript shape alone is not enough. The application projector accepts only approved fields and values, and the final HTTP response is schema-validated.

## Local filesystem adapters

The shipped local adapters use narrowly approved paths and bounded reads. Depending on the source they enforce path containment, reject symlinks, use `O_NOFOLLOW`, cap bytes, and verify that the opened file is still the approved file. Private snapshot adapters additionally require same-UID/GID ownership, exact directory/file modes, stable file identity, strict JSON, JSON Schema validation, and semantic validation.

Do not weaken these checks in a custom adapter merely because the service later validates the DTO. DTO validation is a second boundary; it does not make an unsafe filesystem read safe.

## Snapshot adapters

The three snapshot adapters consume sanitized files only. Their schemas reject unknown properties at privacy-sensitive boundaries and keep `snapshot_status` independent from `review_status`. Status meanings are distinct:

- `AVAILABLE`: validated current representation exists.
- `EMPTY`: successful, explicit empty representation; not an error.
- `UNKNOWN`: the source cannot assert current state; no current data/confidence.
- `STALE`: validated data exists but is too old for the fresh threshold.
- `UNAVAILABLE`: the current observation attempt failed and carries a sanitized error.

Snapshot producers, source-specific extraction logic, and real operational data are excluded from the public export. Implementing a producer is a deployment responsibility and should happen outside the HTTP process.

## Safe process runner: scope and limitations

A bounded process runner exists under `src/adapters/hermes-cli/runner`, but it is **not connected to HTTP routes or to the production observation composition**. Manual refresh does not execute Hermes commands.

The runner accepts capability IDs, not caller-supplied executables or argument arrays. Its frozen registry currently approves only the live-validated profile-list capability for `SafeHermesRunner.run`; retired, unapproved, and deferred IDs are rejected by the process-spec builder. Execution uses `shell: false`, a frozen working directory/environment, concurrency of two, fixed timeout/output classes, ignored stdin, process-group termination, and sanitized lifecycle logs. On timeout or output overflow it discards captured output and terminates the process group.

These controls limit invocation; they do not sandbox the child. There is no container, seccomp policy, privilege drop, filesystem isolation, network isolation, or proof that the `hermes` executable itself is side-effect free. Successful results contain raw stdout/stderr buffers and therefore must be parsed and sanitized before any publication. Several historical commands are explicitly retired because they may expose secrets or trigger network, credential, update, cache, Git, or recovery activity. Do not expose the runner through a generic HTTP endpoint, and do not treat its existence as production integration.
