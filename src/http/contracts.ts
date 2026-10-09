import type { AnySchemaObject } from "ajv";

import type { ObservationAggregateDto } from "../application/observations/observation-service.js";

export type ObservationsResponse = ObservationAggregateDto;

export interface HealthResponse {
  readonly application_name: string;
  readonly application_version: string;
  readonly build_id: string;
  readonly api_version: string;
  readonly application_time: string;
  readonly status: "UP";
  readonly read_only: true;
  readonly authentication_enabled: true;
}

export interface PublicErrorResponse {
  readonly error: string;
  readonly message: string;
  readonly status_code: 400 | 401 | 404 | 405 | 429 | 500;
}

export interface HttpSchemas {
  readonly health: AnySchemaObject;
  readonly observations: AnySchemaObject;
  readonly error: AnySchemaObject;
}

export const HEALTH_RESPONSE_SCHEMA: AnySchemaObject = {
  $id: "https://mission-control.local/http/health-response.schema.json",
  type: "object",
  additionalProperties: false,
  required: [
    "application_name",
    "application_version",
    "build_id",
    "api_version",
    "application_time",
    "status",
    "read_only",
    "authentication_enabled",
  ],
  properties: {
    application_name: { type: "string", minLength: 1, maxLength: 80 },
    application_version: { type: "string", minLength: 1, maxLength: 40 },
    build_id: { type: "string", minLength: 1, maxLength: 80 },
    api_version: { type: "string", pattern: "^v[1-9][0-9]*$" },
    application_time: { type: "string", format: "date-time" },
    status: { const: "UP" },
    read_only: { const: true },
    authentication_enabled: { const: true },
  },
};

export const PUBLIC_ERROR_SCHEMA: AnySchemaObject = {
  $id: "https://mission-control.local/http/public-error.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["error", "message", "status_code"],
  properties: {
    error: { type: "string", pattern: "^[A-Z][A-Z0-9_]*$", maxLength: 80 },
    message: { type: "string", minLength: 1, maxLength: 160 },
    status_code: { enum: [400, 401, 404, 405, 429, 500] },
  },
};

export const EMPTY_QUERY_SCHEMA: AnySchemaObject = {
  type: "object",
  additionalProperties: false,
  maxProperties: 0,
};

const OBSERVATION_METADATA_PROPERTIES = {
  availability: { enum: ["AVAILABLE", "EMPTY", "STALE", "UNAVAILABLE", "UNKNOWN"] },
  completeness: { enum: ["COMPLETE", "PARTIAL", "EMPTY", "UNKNOWN"] },
  freshness: { enum: ["FRESH", "STALE", "EXPIRED", "UNKNOWN"] },
  review_status: { enum: ["NONE", "REVIEW_REQUIRED"] },
  confidence_level: { enum: ["HIGH", "MEDIUM", "LOW", "NONE"] },
  observation_timestamp: {
    oneOf: [{ type: "null" }, { type: "string", format: "date-time" }],
  },
  error_code: {
    oneOf: [
      { type: "null" },
      { type: "string", pattern: "^[A-Z][A-Z0-9_]{0,63}$" },
    ],
  },
} as const;

const OBSERVATION_SLOT_REQUIRED = [
  "source",
  "availability",
  "completeness",
  "freshness",
  "review_status",
  "confidence_level",
  "observation_timestamp",
  "current",
  "error_code",
] as const;

function observationSlotSchema(source: string, current: AnySchemaObject): AnySchemaObject {
  return {
    type: "object",
    additionalProperties: false,
    required: OBSERVATION_SLOT_REQUIRED,
    properties: {
      source: { const: source },
      ...OBSERVATION_METADATA_PROPERTIES,
      current: { oneOf: [{ type: "null" }, current] },
    },
  };
}

const VERSION_CURRENT_SCHEMA: AnySchemaObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "installation_kind",
    "authority",
    "consistency_status",
    "compatibility_status",
    "adapter_version",
  ],
  properties: {
    version: { type: "string", minLength: 1, maxLength: 80 },
    installation_kind: { enum: ["EDITABLE", "INSTALLED"] },
    authority: {
      enum: ["INSTALLED_DISTRIBUTION", "INSTALLED_DISTRIBUTION_CONFIRMED_BY_RUNTIME_SOURCE"],
    },
    consistency_status: { enum: ["MATCHED", "NOT_REQUIRED"] },
    compatibility_status: { enum: ["SUPPORTED", "UNSUPPORTED"] },
    adapter_version: { type: "string", minLength: 1, maxLength: 40 },
  },
};

const PROFILE_CURRENT_SCHEMA: AnySchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["profile_count", "current_profile_count"],
  properties: {
    profile_count: { type: "integer", minimum: 0 },
    current_profile_count: { type: "integer", minimum: 0 },
  },
};

const GATEWAY_CURRENT_SCHEMA: AnySchemaObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "process_state",
    "process_identity_consistency",
    "process_mode",
    "user_service_state",
    "system_service_state",
    "manager_category",
    "duplicate_definition_state",
    "service_definition_state",
  ],
  properties: {
    process_state: { enum: ["RUNNING", "STOPPED", "UNKNOWN"] },
    process_identity_consistency: {
      enum: ["CONSISTENT", "INCONSISTENT", "NOT_APPLICABLE", "UNKNOWN"],
    },
    process_mode: { enum: ["MANAGED", "MANUAL", "UNKNOWN"] },
    user_service_state: { enum: ["ACTIVE", "INACTIVE", "UNAVAILABLE", "UNKNOWN"] },
    system_service_state: { enum: ["ACTIVE", "INACTIVE", "UNAVAILABLE", "UNKNOWN"] },
    manager_category: { enum: ["USER_SERVICE", "SYSTEM_SERVICE", "MANUAL", "NONE", "UNKNOWN"] },
    duplicate_definition_state: { enum: ["DETECTED", "NOT_DETECTED", "UNKNOWN"] },
    service_definition_state: { enum: ["CURRENT", "REVIEW_REQUIRED", "OUTDATED", "UNKNOWN"] },
  },
};

const SCHEDULER_CURRENT_SCHEMA: AnySchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["scheduler_availability", "enabled_job_count", "total_job_count"],
  properties: {
    scheduler_availability: { enum: ["AVAILABLE", "EMPTY"] },
    enabled_job_count: { type: "integer", minimum: 0 },
    total_job_count: { type: "integer", minimum: 0 },
  },
};

function summaryCurrentSchema(properties: Record<string, AnySchemaObject>): AnySchemaObject {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary"],
    properties: {
      summary: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(properties),
        properties,
      },
    },
  };
}

const ACCOUNTING_CURRENT_SCHEMA = summaryCurrentSchema({
  income_idr: { type: "integer", minimum: 0 },
  expense_idr: { type: "integer", minimum: 0 },
  total_cash_outflow_idr: { type: "integer", minimum: 0 },
  operational_surplus_idr: { type: "integer" },
  net_cash_surplus_idr: { type: "integer" },
  transaction_count: { type: "integer", minimum: 0 },
});

const BANK_JOURNAL_CURRENT_SCHEMA = summaryCurrentSchema({
  quality_issue_count: { type: "integer", minimum: 0 },
  unresolved_mapping_count: { type: "integer", minimum: 0 },
  incomplete_evidence_count: { type: "integer", minimum: 0 },
  external_metadata_stale_count: { type: "integer", minimum: 0 },
  source_conflict_count: { type: "integer", minimum: 0 },
});

const SUBMISSION_CURRENT_SCHEMA = summaryCurrentSchema({
  total_count: { type: "integer", minimum: 0 },
  active_count: { type: "integer", minimum: 0 },
  revision_requested_count: { type: "integer", minimum: 0 },
  accepted_count: { type: "integer", minimum: 0 },
  rejected_count: { type: "integer", minimum: 0 },
  no_next_action_count: { type: "integer", minimum: 0 },
});

export const OBSERVATIONS_RESPONSE_SCHEMA: AnySchemaObject = {
  $id: "https://mission-control.local/http/observations-response.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["contract_version", "generated_at", "observations"],
  properties: {
    contract_version: { const: "1.0.0" },
    generated_at: { type: "string", format: "date-time" },
    observations: {
      type: "array",
      minItems: 7,
      maxItems: 7,
      prefixItems: [
        observationSlotSchema("HERMES_VERSION", VERSION_CURRENT_SCHEMA),
        observationSlotSchema("HERMES_PROFILE", PROFILE_CURRENT_SCHEMA),
        observationSlotSchema("HERMES_GATEWAY", GATEWAY_CURRENT_SCHEMA),
        observationSlotSchema("HERMES_SCHEDULER", SCHEDULER_CURRENT_SCHEMA),
        observationSlotSchema("ACCOUNTING_V2", ACCOUNTING_CURRENT_SCHEMA),
        observationSlotSchema("BANK_JOURNAL", BANK_JOURNAL_CURRENT_SCHEMA),
        observationSlotSchema("SUBMISSION_TRACKER", SUBMISSION_CURRENT_SCHEMA),
      ],
      items: false,
    },
  },
};
