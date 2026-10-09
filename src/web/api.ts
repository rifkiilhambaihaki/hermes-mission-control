export const OBSERVATION_SOURCES = [
  "HERMES_VERSION",
  "HERMES_PROFILE",
  "HERMES_GATEWAY",
  "HERMES_SCHEDULER",
  "ACCOUNTING_V2",
  "BANK_JOURNAL",
  "SUBMISSION_TRACKER",
] as const;

export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];
export type Availability = "AVAILABLE" | "EMPTY" | "UNKNOWN" | "UNAVAILABLE" | "STALE";
export type Completeness = "COMPLETE" | "PARTIAL" | "EMPTY" | "UNKNOWN";
export type Freshness = "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
export type ReviewStatus = "NONE" | "REVIEW_REQUIRED";
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export interface ObservationSlot {
  readonly source: ObservationSource;
  readonly availability: Availability;
  readonly completeness: Completeness;
  readonly freshness: Freshness;
  readonly review_status: ReviewStatus;
  readonly confidence_level: ConfidenceLevel;
  readonly observation_timestamp: string | null;
  readonly current: Readonly<Record<string, unknown>> | null;
  readonly error_code: string | null;
}

export interface ObservationAggregate {
  readonly contract_version: "1.0.0";
  readonly generated_at: string;
  readonly observations: readonly ObservationSlot[];
}

export type ApiFailureKind = "AUTH_REQUIRED" | "ACCESS_RESTRICTED" | "API_UNAVAILABLE" | "MALFORMED_RESPONSE";

export class ObservationApiError extends Error {
  readonly kind: ApiFailureKind;

  constructor(kind: ApiFailureKind) {
    super(kind);
    this.name = "ObservationApiError";
    this.kind = kind;
  }
}

type JsonRecord = Record<string, unknown>;

const AVAILABILITIES = new Set<Availability>(["AVAILABLE", "EMPTY", "UNKNOWN", "UNAVAILABLE", "STALE"]);
const COMPLETENESS = new Set<Completeness>(["COMPLETE", "PARTIAL", "EMPTY", "UNKNOWN"]);
const FRESHNESS = new Set<Freshness>(["FRESH", "STALE", "EXPIRED", "UNKNOWN"]);
const REVIEWS = new Set<ReviewStatus>(["NONE", "REVIEW_REQUIRED"]);
const CONFIDENCE = new Set<ConfidenceLevel>(["HIGH", "MEDIUM", "LOW", "NONE"]);
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>): value is T {
  return typeof value === "string" && allowed.has(value as T);
}

function isDateTime(value: unknown): value is string {
  return typeof value === "string" && DATE_TIME.test(value) && Number.isFinite(Date.parse(value));
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && Array.from(value).length <= maximum;
}

function validVersionCurrent(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "installation_kind", "authority", "consistency_status", "compatibility_status", "adapter_version",
  ])) return false;
  return isBoundedString(value.version, 80)
    && ["EDITABLE", "INSTALLED"].includes(String(value.installation_kind))
    && ["INSTALLED_DISTRIBUTION", "INSTALLED_DISTRIBUTION_CONFIRMED_BY_RUNTIME_SOURCE"].includes(String(value.authority))
    && ["MATCHED", "NOT_REQUIRED"].includes(String(value.consistency_status))
    && ["SUPPORTED", "UNSUPPORTED"].includes(String(value.compatibility_status))
    && isBoundedString(value.adapter_version, 40);
}

function validProfileCurrent(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["profile_count", "current_profile_count"])
    && isNonnegativeInteger(value.profile_count)
    && isNonnegativeInteger(value.current_profile_count)
    && Number(value.current_profile_count) <= Number(value.profile_count);
}

function validGatewayCurrent(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, [
    "process_state", "process_identity_consistency", "process_mode", "user_service_state",
    "system_service_state", "manager_category", "duplicate_definition_state", "service_definition_state",
  ])) return false;
  return ["RUNNING", "STOPPED", "UNKNOWN"].includes(String(value.process_state))
    && ["CONSISTENT", "INCONSISTENT", "NOT_APPLICABLE", "UNKNOWN"].includes(String(value.process_identity_consistency))
    && ["MANAGED", "MANUAL", "UNKNOWN"].includes(String(value.process_mode))
    && ["ACTIVE", "INACTIVE", "UNAVAILABLE", "UNKNOWN"].includes(String(value.user_service_state))
    && ["ACTIVE", "INACTIVE", "UNAVAILABLE", "UNKNOWN"].includes(String(value.system_service_state))
    && ["USER_SERVICE", "SYSTEM_SERVICE", "MANUAL", "NONE", "UNKNOWN"].includes(String(value.manager_category))
    && ["DETECTED", "NOT_DETECTED", "UNKNOWN"].includes(String(value.duplicate_definition_state))
    && ["CURRENT", "REVIEW_REQUIRED", "OUTDATED", "UNKNOWN"].includes(String(value.service_definition_state));
}

function validSchedulerCurrent(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["scheduler_availability", "enabled_job_count", "total_job_count"])
    && ["AVAILABLE", "EMPTY"].includes(String(value.scheduler_availability))
    && isNonnegativeInteger(value.enabled_job_count)
    && isNonnegativeInteger(value.total_job_count)
    && Number(value.enabled_job_count) <= Number(value.total_job_count);
}

function validSummary(value: unknown, fields: Readonly<Record<string, "integer" | "nonnegative">>): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["summary"])) return false;
  const summary = value.summary;
  if (!isRecord(summary) || !hasExactKeys(summary, Object.keys(fields))) return false;
  return Object.entries(fields).every(([field, kind]) =>
    kind === "nonnegative" ? isNonnegativeInteger(summary[field]) : isInteger(summary[field]));
}

const CURRENT_VALIDATORS: Readonly<Record<ObservationSource, (value: unknown) => boolean>> = {
  HERMES_VERSION: validVersionCurrent,
  HERMES_PROFILE: validProfileCurrent,
  HERMES_GATEWAY: validGatewayCurrent,
  HERMES_SCHEDULER: validSchedulerCurrent,
  ACCOUNTING_V2: (value) => validSummary(value, {
    income_idr: "nonnegative",
    expense_idr: "nonnegative",
    total_cash_outflow_idr: "nonnegative",
    operational_surplus_idr: "integer",
    net_cash_surplus_idr: "integer",
    transaction_count: "nonnegative",
  }),
  BANK_JOURNAL: (value) => validSummary(value, {
    quality_issue_count: "nonnegative",
    unresolved_mapping_count: "nonnegative",
    incomplete_evidence_count: "nonnegative",
    external_metadata_stale_count: "nonnegative",
    source_conflict_count: "nonnegative",
  }),
  SUBMISSION_TRACKER: (value) => validSummary(value, {
    total_count: "nonnegative",
    active_count: "nonnegative",
    revision_requested_count: "nonnegative",
    accepted_count: "nonnegative",
    rejected_count: "nonnegative",
    no_next_action_count: "nonnegative",
  }),
};

function validSlot(value: unknown, source: ObservationSource): value is ObservationSlot {
  if (!isRecord(value) || !hasExactKeys(value, [
    "source", "availability", "completeness", "freshness", "review_status", "confidence_level",
    "observation_timestamp", "current", "error_code",
  ])) return false;
  if (value.source !== source
    || !isEnum(value.availability, AVAILABILITIES)
    || !isEnum(value.completeness, COMPLETENESS)
    || !isEnum(value.freshness, FRESHNESS)
    || !isEnum(value.review_status, REVIEWS)
    || !isEnum(value.confidence_level, CONFIDENCE)) return false;
  if (value.observation_timestamp !== null && !isDateTime(value.observation_timestamp)) return false;
  if (value.error_code !== null && (typeof value.error_code !== "string" || !ERROR_CODE.test(value.error_code))) return false;
  const currentIsValid = value.current === null || CURRENT_VALIDATORS[source](value.current);
  if (!currentIsValid) return false;
  if (["UNAVAILABLE", "UNKNOWN"].includes(value.availability as string)) {
    if (value.current !== null || value.confidence_level !== "NONE") return false;
  }
  if (value.availability === "AVAILABLE" && value.current === null) return false;
  if (value.availability === "EMPTY") {
    if (value.current === null || value.completeness !== "EMPTY" || value.error_code !== null) return false;
  }
  if (value.availability === "UNAVAILABLE" && value.error_code === null) return false;
  return true;
}

export function parseObservationAggregate(value: unknown): ObservationAggregate {
  if (!isRecord(value)
    || !hasExactKeys(value, ["contract_version", "generated_at", "observations"])
    || value.contract_version !== "1.0.0"
    || !isDateTime(value.generated_at)) {
    throw new ObservationApiError("MALFORMED_RESPONSE");
  }
  const observations = value.observations;
  if (!Array.isArray(observations)
    || observations.length !== OBSERVATION_SOURCES.length
    || !OBSERVATION_SOURCES.every((source, index) => validSlot(observations[index], source))) {
    throw new ObservationApiError("MALFORMED_RESPONSE");
  }
  return value as unknown as ObservationAggregate;
}

export async function fetchObservations(fetcher: typeof fetch = fetch): Promise<ObservationAggregate> {
  let response: Response;
  try {
    response = await fetcher("/api/v1/observations", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ObservationApiError("API_UNAVAILABLE");
  }
  if (response.status === 401) throw new ObservationApiError("AUTH_REQUIRED");
  if (response.status === 403 || response.status === 429) throw new ObservationApiError("ACCESS_RESTRICTED");
  if (!response.ok) throw new ObservationApiError("API_UNAVAILABLE");
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ObservationApiError("MALFORMED_RESPONSE");
  }
  return parseObservationAggregate(value);
}
