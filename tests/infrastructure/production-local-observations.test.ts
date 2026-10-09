import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createObservation } from "../../src/domain/observation/observation.js";
import {
  createLocalObservationService,
  type ProductionLocalObservationAdapters,
} from "../../src/infrastructure/observations/production-local-observations.js";

const fixedTime = "2027-01-15T03:00:00.000Z";
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function adapters(): ProductionLocalObservationAdapters {
  return {
    versionAdapter: {
      read: async () => ({
        availability: "AVAILABLE",
        reviewStatus: "NONE",
        current: {
          version: "0.16.0",
          installationKind: "EDITABLE",
          authority: "INSTALLED_DISTRIBUTION_CONFIRMED_BY_RUNTIME_SOURCE",
          consistencyStatus: "MATCHED",
          compatibilityStatus: "SUPPORTED",
          adapterVersion: "1.0.0",
        },
        error: null,
      }),
    },
    gatewayAdapter: {
      observe: async (request) => createObservation({
        availability: "AVAILABLE",
        reviewStatus: "NONE",
        completeness: "PARTIAL",
        freshness: "FRESH",
        provenance: request,
        confidence: { level: "MEDIUM", reasons: ["Synthetic identity match."] },
        current: {
          processState: "RUNNING",
          processIdentityConsistency: "CONSISTENT",
          processMode: "UNKNOWN",
          userServiceState: "UNKNOWN",
          systemServiceState: "UNKNOWN",
          managerCategory: "UNKNOWN",
          duplicateDefinitionState: "UNKNOWN",
          serviceDefinitionState: "UNKNOWN",
        },
        error: null,
        lastKnownGood: null,
      }),
    },
    schedulerAdapter: {
      observe: async (request) => createObservation({
        availability: "AVAILABLE",
        reviewStatus: "NONE",
        completeness: "COMPLETE",
        freshness: "FRESH",
        provenance: request,
        confidence: { level: "HIGH", reasons: ["Synthetic stable registry."] },
        current: {
          schedulerAvailability: "AVAILABLE",
          enabledJobCount: 2,
          totalJobCount: 3,
        },
        error: null,
        lastKnownGood: null,
      }),
    },
    accountingAdapter: {
      observe: async (request) => createObservation({
        availability: "AVAILABLE",
        reviewStatus: "REVIEW_REQUIRED",
        completeness: "PARTIAL",
        freshness: "FRESH",
        provenance: { source: request.source, observedAt: request.asOf, fetchedAt: request.asOf },
        confidence: { level: "MEDIUM", reasons: ["Synthetic aggregate snapshot."] },
        current: {
          summary: {
            income_idr: 10_000,
            expense_idr: 4_000,
            total_cash_outflow_idr: 4_000,
            operational_surplus_idr: 6_000,
            net_cash_surplus_idr: 6_000,
            transaction_count: 3,
          },
          thresholds: [],
          asset_snapshots: [],
          asset_integrity: { historical_missing_period_count: 0, historical_missing_periods: [] },
          category_details: { items: [], included_count: 0, total_count: 0, truncated: false },
        },
        error: null,
        lastKnownGood: null,
      }),
    },
    bankJournalAdapter: {
      observe: async (request) => createObservation({
        availability: "AVAILABLE",
        reviewStatus: "REVIEW_REQUIRED",
        completeness: "PARTIAL",
        freshness: "FRESH",
        provenance: { source: request.source, observedAt: request.asOf, fetchedAt: request.asOf },
        confidence: { level: "MEDIUM", reasons: ["Synthetic aggregate snapshot."] },
        current: {
          summary: {
            quality_issue_count: 10,
            unresolved_mapping_count: 2,
            incomplete_evidence_count: 6,
            external_metadata_stale_count: 0,
            source_conflict_count: 2,
          },
          issue_details: { items: [], included_count: 0, total_count: 10, truncated: true },
        },
        error: null,
        lastKnownGood: null,
      }),
    },
    submissionAdapter: {
      observe: async (request) => createObservation({
        availability: "AVAILABLE",
        reviewStatus: "NONE",
        completeness: "PARTIAL",
        freshness: "FRESH",
        provenance: { source: request.source, observedAt: request.asOf, fetchedAt: request.asOf },
        confidence: { level: "MEDIUM", reasons: ["Synthetic aggregate snapshot."] },
        current: {
          summary: {
            total_count: 6,
            active_count: 3,
            revision_requested_count: 1,
            accepted_count: 0,
            rejected_count: 2,
            no_next_action_count: 0,
          },
          paper_details: { items: [], included_count: 0, total_count: 6, truncated: true },
        },
        error: null,
        lastKnownGood: null,
      }),
    },
  };
}

describe("production local observation composition", () => {
  it("activates all approved sources while Profile remains pending", async () => {
    const aggregate = await createLocalObservationService({
      clock: () => new Date(fixedTime),
      adapters: adapters(),
    }).collect();

    expect(aggregate.observations.map((slot) => [slot.source, slot.availability, slot.error_code])).toEqual([
      ["HERMES_VERSION", "AVAILABLE", null],
      ["HERMES_PROFILE", "UNKNOWN", "INTEGRATION_PENDING"],
      ["HERMES_GATEWAY", "AVAILABLE", null],
      ["HERMES_SCHEDULER", "AVAILABLE", null],
      ["ACCOUNTING_V2", "AVAILABLE", null],
      ["BANK_JOURNAL", "AVAILABLE", null],
      ["SUBMISSION_TRACKER", "AVAILABLE", null],
    ]);
  });

  it("isolates each local adapter failure without hiding the other sources", async () => {
    const failureScenarios: ReadonlyArray<{
      readonly source: "HERMES_VERSION" | "HERMES_GATEWAY" | "HERMES_SCHEDULER" | "ACCOUNTING_V2" | "BANK_JOURNAL" | "SUBMISSION_TRACKER";
      readonly fail: (value: ProductionLocalObservationAdapters) => ProductionLocalObservationAdapters;
    }> = [
      {
        source: "HERMES_VERSION",
        fail: (value) => ({
          ...value,
          versionAdapter: { read: async () => { throw new Error("synthetic private canary"); } },
        }),
      },
      {
        source: "HERMES_GATEWAY",
        fail: (value) => ({
          ...value,
          gatewayAdapter: { observe: async () => { throw new Error("synthetic private canary"); } },
        }),
      },
      {
        source: "HERMES_SCHEDULER",
        fail: (value) => ({
          ...value,
          schedulerAdapter: { observe: async () => { throw new Error("synthetic private canary"); } },
        }),
      },
      {
        source: "ACCOUNTING_V2",
        fail: (value) => ({
          ...value,
          accountingAdapter: { observe: async () => { throw new Error("synthetic private canary"); } },
        }),
      },
      {
        source: "BANK_JOURNAL",
        fail: (value) => ({
          ...value,
          bankJournalAdapter: { observe: async () => { throw new Error("synthetic private canary"); } },
        }),
      },
      {
        source: "SUBMISSION_TRACKER",
        fail: (value) => ({
          ...value,
          submissionAdapter: { observe: async () => { throw new Error("synthetic private canary"); } },
        }),
      },
    ];

    for (const scenario of failureScenarios) {
      const aggregate = await createLocalObservationService({
        clock: () => new Date(fixedTime),
        adapters: scenario.fail(adapters()),
      }).collect();
      const bySource = new Map(aggregate.observations.map((slot) => [slot.source, slot]));

      expect(bySource.get(scenario.source)).toMatchObject({
        availability: "UNAVAILABLE",
        current: null,
        error_code: "SOURCE_OBSERVATION_FAILED",
      });
      for (const activeSource of [
        "HERMES_VERSION",
        "HERMES_GATEWAY",
        "HERMES_SCHEDULER",
        "ACCOUNTING_V2",
        "BANK_JOURNAL",
        "SUBMISSION_TRACKER",
      ] as const) {
        if (activeSource !== scenario.source) {
          expect(bySource.get(activeSource)?.availability).toBe("AVAILABLE");
        }
      }
      expect(JSON.stringify(aggregate)).not.toContain("synthetic private canary");
    }
  });

  it("requires explicit path configuration and excludes CLI/request-driven wiring", async () => {
    const source = await readFile(
      `${projectRoot}/src/infrastructure/observations/production-local-observations.ts`,
      "utf8",
    );
    const bootstrap = await readFile(`${projectRoot}/src/bootstrap/mission-control.ts`, "utf8");
    const runtimeConfig = await readFile(`${projectRoot}/src/infrastructure/runtime-config.ts`, "utf8");

    for (const key of [
      "HMC_HERMES_PROFILE_ROOT",
      "HMC_HERMES_SITE_PACKAGES_ROOT",
      "HMC_HERMES_DISTRIBUTION_METADATA_DIR",
      "HMC_HERMES_SOURCE_ROOT",
      "HMC_SCHEMA_ROOT",
      "HMC_ACCOUNTING_SNAPSHOT_PATH",
      "HMC_SUBMISSION_SNAPSHOT_PATH",
      "HMC_BANK_JOURNAL_SNAPSHOT_PATH",
    ]) expect(runtimeConfig).toContain(key);
    expect(source).not.toMatch(/\/home\/[^/]+/);
    expect(source).not.toMatch(/google_token|google_client_secret|Credentials|googleapis/);
    expect(source).not.toMatch(/child_process|SafeHermesRunner|hermes\s+--version|profileAdapter|request\./);
    expect(source).not.toContain('"RUNNING"');
    expect(source).not.toContain("enabledJobCount:");

    expect(bootstrap).toContain("createProductionLocalObservationService");
    expect(bootstrap).toContain("observationService");
  });
});
