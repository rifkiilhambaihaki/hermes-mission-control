import {
  observationInvariantViolations,
  type Availability,
  type Completeness,
  type ConfidenceLevel,
  type Observation,
} from "../../domain/observation/observation.js";
import type { Freshness } from "../../domain/observation/freshness.js";
import type { ReviewStatus } from "../../domain/contracts/snapshot-types.js";

export const OBSERVATION_SOURCE_IDS = Object.freeze([
  "HERMES_VERSION",
  "HERMES_PROFILE",
  "HERMES_GATEWAY",
  "HERMES_SCHEDULER",
  "ACCOUNTING_V2",
  "BANK_JOURNAL",
  "SUBMISSION_TRACKER",
] as const);

export type ObservationSourceId = (typeof OBSERVATION_SOURCE_IDS)[number];
export type ObservationProvider = () => Promise<Observation<unknown>>;
export type ObservationProviderMap = Readonly<Record<ObservationSourceId, ObservationProvider>>;

export interface ObservationSlotDto {
  readonly source: ObservationSourceId;
  readonly availability: Availability;
  readonly completeness: Completeness;
  readonly freshness: Freshness;
  readonly review_status: ReviewStatus;
  readonly confidence_level: ConfidenceLevel;
  readonly observation_timestamp: string | null;
  readonly current: Readonly<Record<string, unknown>> | null;
  readonly error_code: string | null;
}

export interface ObservationAggregateDto {
  readonly contract_version: "1.0.0";
  readonly generated_at: string;
  readonly observations: readonly ObservationSlotDto[];
}

export interface ObservationServiceOptions {
  readonly clock: () => Date;
  readonly providers?: Partial<ObservationProviderMap>;
}

const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SEMANTIC_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("Expected an observation data object.");
  return value;
}

function stringField(
  source: Record<string, unknown>,
  field: string,
  allowed?: ReadonlySet<string>,
): string {
  const value = source[field];
  if (typeof value !== "string" || value.length === 0 || (allowed !== undefined && !allowed.has(value))) {
    throw new TypeError("Observation data did not match its canonical contract.");
  }
  return value;
}

function integerField(
  source: Record<string, unknown>,
  field: string,
  options: { readonly nonnegative?: boolean } = {},
): number {
  const value = source[field];
  if (
    !Number.isSafeInteger(value) ||
    (options.nonnegative === true && Number(value) < 0)
  ) {
    throw new TypeError("Observation data did not match its canonical contract.");
  }
  return Number(value);
}

function projectVersion(value: unknown): Readonly<Record<string, unknown>> {
  const source = record(value);
  const version = stringField(source, "version");
  const adapterVersion = stringField(source, "adapterVersion");
  if (
    !SEMANTIC_VERSION.test(version) ||
    version.length > 80 ||
    Array.from(adapterVersion).length > 40
  ) {
    throw new TypeError("Invalid bounded semantic version.");
  }
  return Object.freeze({
    version,
    installation_kind: stringField(source, "installationKind", new Set(["EDITABLE", "INSTALLED"])),
    authority: stringField(
      source,
      "authority",
      new Set(["INSTALLED_DISTRIBUTION", "INSTALLED_DISTRIBUTION_CONFIRMED_BY_RUNTIME_SOURCE"]),
    ),
    consistency_status: stringField(source, "consistencyStatus", new Set(["MATCHED", "NOT_REQUIRED"])),
    compatibility_status: stringField(source, "compatibilityStatus", new Set(["SUPPORTED", "UNSUPPORTED"])),
    adapter_version: adapterVersion,
  });
}

function projectProfile(value: unknown): Readonly<Record<string, unknown>> {
  const source = record(value);
  if (!Array.isArray(source.profiles)) throw new TypeError("Invalid Profile observation.");
  let currentCount = 0;
  for (const item of source.profiles) {
    const profile = record(item);
    stringField(profile, "name");
    if (typeof profile.current !== "boolean") throw new TypeError("Invalid Profile observation.");
    if (profile.current) currentCount += 1;
  }
  return Object.freeze({
    profile_count: source.profiles.length,
    current_profile_count: currentCount,
  });
}

function projectGateway(value: unknown): Readonly<Record<string, unknown>> {
  const source = record(value);
  return Object.freeze({
    process_state: stringField(source, "processState", new Set(["RUNNING", "STOPPED", "UNKNOWN"])),
    process_identity_consistency: stringField(
      source,
      "processIdentityConsistency",
      new Set(["CONSISTENT", "INCONSISTENT", "NOT_APPLICABLE", "UNKNOWN"]),
    ),
    process_mode: stringField(source, "processMode", new Set(["MANAGED", "MANUAL", "UNKNOWN"])),
    user_service_state: stringField(
      source,
      "userServiceState",
      new Set(["ACTIVE", "INACTIVE", "UNAVAILABLE", "UNKNOWN"]),
    ),
    system_service_state: stringField(
      source,
      "systemServiceState",
      new Set(["ACTIVE", "INACTIVE", "UNAVAILABLE", "UNKNOWN"]),
    ),
    manager_category: stringField(
      source,
      "managerCategory",
      new Set(["USER_SERVICE", "SYSTEM_SERVICE", "MANUAL", "NONE", "UNKNOWN"]),
    ),
    duplicate_definition_state: stringField(
      source,
      "duplicateDefinitionState",
      new Set(["DETECTED", "NOT_DETECTED", "UNKNOWN"]),
    ),
    service_definition_state: stringField(
      source,
      "serviceDefinitionState",
      new Set(["CURRENT", "REVIEW_REQUIRED", "OUTDATED", "UNKNOWN"]),
    ),
  });
}

function projectScheduler(value: unknown): Readonly<Record<string, unknown>> {
  const source = record(value);
  const total = integerField(source, "totalJobCount", { nonnegative: true });
  const enabled = integerField(source, "enabledJobCount", { nonnegative: true });
  if (enabled > total) throw new TypeError("Enabled Scheduler count cannot exceed total count.");
  return Object.freeze({
    scheduler_availability: stringField(source, "schedulerAvailability", new Set(["AVAILABLE", "EMPTY"])),
    enabled_job_count: enabled,
    total_job_count: total,
  });
}

function projectAccounting(value: unknown): Readonly<Record<string, unknown>> {
  const summary = record(record(value).summary);
  return Object.freeze({
    summary: Object.freeze({
      income_idr: integerField(summary, "income_idr", { nonnegative: true }),
      expense_idr: integerField(summary, "expense_idr", { nonnegative: true }),
      total_cash_outflow_idr: integerField(summary, "total_cash_outflow_idr", { nonnegative: true }),
      operational_surplus_idr: integerField(summary, "operational_surplus_idr"),
      net_cash_surplus_idr: integerField(summary, "net_cash_surplus_idr"),
      transaction_count: integerField(summary, "transaction_count", { nonnegative: true }),
    }),
  });
}

function projectBankJournal(value: unknown): Readonly<Record<string, unknown>> {
  const summary = record(record(value).summary);
  return Object.freeze({
    summary: Object.freeze({
      quality_issue_count: integerField(summary, "quality_issue_count", { nonnegative: true }),
      unresolved_mapping_count: integerField(summary, "unresolved_mapping_count", { nonnegative: true }),
      incomplete_evidence_count: integerField(summary, "incomplete_evidence_count", { nonnegative: true }),
      external_metadata_stale_count: integerField(summary, "external_metadata_stale_count", { nonnegative: true }),
      source_conflict_count: integerField(summary, "source_conflict_count", { nonnegative: true }),
    }),
  });
}

function projectSubmission(value: unknown): Readonly<Record<string, unknown>> {
  const summary = record(record(value).summary);
  return Object.freeze({
    summary: Object.freeze({
      total_count: integerField(summary, "total_count", { nonnegative: true }),
      active_count: integerField(summary, "active_count", { nonnegative: true }),
      revision_requested_count: integerField(summary, "revision_requested_count", { nonnegative: true }),
      accepted_count: integerField(summary, "accepted_count", { nonnegative: true }),
      rejected_count: integerField(summary, "rejected_count", { nonnegative: true }),
      no_next_action_count: integerField(summary, "no_next_action_count", { nonnegative: true }),
    }),
  });
}

const projectors: Readonly<Record<ObservationSourceId, (value: unknown) => Readonly<Record<string, unknown>>>> =
  Object.freeze({
    HERMES_VERSION: projectVersion,
    HERMES_PROFILE: projectProfile,
    HERMES_GATEWAY: projectGateway,
    HERMES_SCHEDULER: projectScheduler,
    ACCOUNTING_V2: projectAccounting,
    BANK_JOURNAL: projectBankJournal,
    SUBMISSION_TRACKER: projectSubmission,
  });

function validTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (daysInMonth[month - 1] ?? 0) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

function pendingSlot(source: ObservationSourceId): ObservationSlotDto {
  return Object.freeze({
    source,
    availability: "UNKNOWN",
    completeness: "UNKNOWN",
    freshness: "UNKNOWN",
    review_status: "REVIEW_REQUIRED",
    confidence_level: "NONE",
    observation_timestamp: null,
    current: null,
    error_code: "INTEGRATION_PENDING",
  });
}

function failedSlot(source: ObservationSourceId): ObservationSlotDto {
  return Object.freeze({
    source,
    availability: "UNAVAILABLE",
    completeness: "UNKNOWN",
    freshness: "UNKNOWN",
    review_status: "REVIEW_REQUIRED",
    confidence_level: "NONE",
    observation_timestamp: null,
    current: null,
    error_code: "SOURCE_OBSERVATION_FAILED",
  });
}

function invalidSlot(source: ObservationSourceId): ObservationSlotDto {
  return Object.freeze({
    source,
    availability: "UNKNOWN",
    completeness: "UNKNOWN",
    freshness: "UNKNOWN",
    review_status: "REVIEW_REQUIRED",
    confidence_level: "NONE",
    observation_timestamp: null,
    current: null,
    error_code: "INVALID_OBSERVATION_CONTRACT",
  });
}

function normalizeSlot(source: ObservationSourceId, observation: Observation<unknown>): ObservationSlotDto {
  if (observationInvariantViolations(observation).length > 0) {
    throw new TypeError("Observation invariant violation.");
  }
  const timestamp = observation.provenance?.observedAt ?? null;
  if (timestamp !== null && !validTimestamp(timestamp)) throw new TypeError("Invalid observation timestamp.");
  if (observation.provenance !== null && !validTimestamp(observation.provenance.fetchedAt)) {
    throw new TypeError("Invalid fetch timestamp.");
  }
  if (observation.error !== null && !ERROR_CODE.test(observation.error.code)) {
    throw new TypeError("Invalid observation error code.");
  }
  const current = observation.current === null ? null : projectors[source](observation.current);
  return Object.freeze({
    source,
    availability: observation.availability,
    completeness: observation.completeness,
    freshness: observation.freshness,
    review_status: observation.reviewStatus,
    confidence_level: observation.confidence.level,
    observation_timestamp: timestamp,
    current,
    error_code: observation.error?.code ?? null,
  });
}

export class ObservationService {
  readonly #clock: () => Date;
  readonly #providers: Partial<ObservationProviderMap>;

  constructor(options: ObservationServiceOptions) {
    this.#clock = options.clock;
    this.#providers = Object.freeze({ ...(options.providers ?? {}) });
  }

  async #observeSource(source: ObservationSourceId): Promise<ObservationSlotDto> {
    const provider = this.#providers[source];
    if (provider === undefined) return pendingSlot(source);
    let observation: Observation<unknown>;
    try {
      observation = await provider();
    } catch {
      return failedSlot(source);
    }
    try {
      return normalizeSlot(source, observation);
    } catch {
      return invalidSlot(source);
    }
  }

  async collect(): Promise<ObservationAggregateDto> {
    const observations = await Promise.all(
      OBSERVATION_SOURCE_IDS.map(async (source) => this.#observeSource(source)),
    );
    const now = this.#clock();
    if (!Number.isFinite(now.getTime())) throw new TypeError("Observation clock returned an invalid instant.");
    return Object.freeze({
      contract_version: "1.0.0",
      generated_at: now.toISOString(),
      observations: Object.freeze(observations),
    });
  }
}
