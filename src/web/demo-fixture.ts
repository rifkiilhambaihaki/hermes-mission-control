import type { ObservationAggregate, ObservationSlot, ObservationSource } from "./api";

const generatedAt = "2030-01-15T12:00:00.000Z";

function slot(
  source: ObservationSource,
  overrides: Partial<ObservationSlot>,
): ObservationSlot {
  return {
    source,
    availability: "AVAILABLE",
    completeness: "COMPLETE",
    freshness: "FRESH",
    review_status: "NONE",
    confidence_level: "HIGH",
    observation_timestamp: "2030-01-15T11:59:40.000Z",
    current: null,
    error_code: null,
    ...overrides,
  };
}

export const DEMO_OBSERVATIONS: ObservationAggregate = {
  contract_version: "1.0.0",
  generated_at: generatedAt,
  observations: [
    slot("HERMES_VERSION", {
      current: {
        version: "0.9.0-demo",
        installation_kind: "INSTALLED",
        authority: "INSTALLED_DISTRIBUTION",
        consistency_status: "NOT_REQUIRED",
        compatibility_status: "SUPPORTED",
        adapter_version: "1.0.0",
      },
    }),
    slot("HERMES_PROFILE", {
      current: { profile_count: 2, current_profile_count: 1 },
    }),
    slot("HERMES_GATEWAY", {
      completeness: "PARTIAL",
      review_status: "REVIEW_REQUIRED",
      confidence_level: "MEDIUM",
      current: {
        process_state: "RUNNING",
        process_identity_consistency: "CONSISTENT",
        process_mode: "UNKNOWN",
        user_service_state: "UNKNOWN",
        system_service_state: "UNKNOWN",
        manager_category: "UNKNOWN",
        duplicate_definition_state: "UNKNOWN",
        service_definition_state: "UNKNOWN",
      },
    }),
    slot("HERMES_SCHEDULER", {
      current: { scheduler_availability: "AVAILABLE", enabled_job_count: 4, total_job_count: 6 },
    }),
    slot("ACCOUNTING_V2", {
      current: {
        summary: {
          income_idr: 8_500_000,
          expense_idr: 2_665_842,
          total_cash_outflow_idr: 2_665_842,
          operational_surplus_idr: 5_834_158,
          net_cash_surplus_idr: 5_834_158,
          transaction_count: 38,
        },
      },
    }),
    slot("BANK_JOURNAL", {
      availability: "STALE",
      completeness: "PARTIAL",
      freshness: "STALE",
      review_status: "REVIEW_REQUIRED",
      confidence_level: "LOW",
      observation_timestamp: "2030-01-12T08:00:00.000Z",
      current: {
        summary: {
          quality_issue_count: 2,
          unresolved_mapping_count: 1,
          incomplete_evidence_count: 1,
          external_metadata_stale_count: 3,
          source_conflict_count: 0,
        },
      },
      error_code: "SNAPSHOT_STALE",
    }),
    slot("SUBMISSION_TRACKER", {
      availability: "UNKNOWN",
      completeness: "UNKNOWN",
      freshness: "UNKNOWN",
      review_status: "REVIEW_REQUIRED",
      confidence_level: "NONE",
      observation_timestamp: null,
      current: null,
      error_code: "INTEGRATION_PENDING",
    }),
  ],
};
