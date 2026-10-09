import { describe, expect, it } from "vitest";

import { ObservationService } from "../../src/application/observations/observation-service.js";
import { createObservation } from "../../src/domain/observation/observation.js";

function availableVersion(observedAt: string) {
  return createObservation({
    availability: "AVAILABLE" as const,
    reviewStatus: "NONE" as const,
    completeness: "COMPLETE" as const,
    freshness: "FRESH" as const,
    provenance: { source: "HERMES_VERSION_METADATA", observedAt, fetchedAt: observedAt },
    confidence: { level: "HIGH" as const, reasons: ["Synthetic source."] },
    current: {
      version: "0.16.0",
      installationKind: "INSTALLED",
      authority: "INSTALLED_DISTRIBUTION",
      consistencyStatus: "NOT_REQUIRED",
      compatibilityStatus: "SUPPORTED",
      adapterVersion: "1.0.0",
    },
    error: null,
    lastKnownGood: null,
  });
}

describe("ObservationService chronology", () => {
  it("generates the aggregate timestamp only after source collection completes", async () => {
    let providerCompleted = false;
    const service = new ObservationService({
      clock: () => new Date(providerCompleted
        ? "2027-01-15T03:01:00.000Z"
        : "2027-01-15T02:59:00.000Z"),
      providers: {
        HERMES_VERSION: async () => {
          providerCompleted = true;
          return availableVersion("2027-01-15T03:00:00.000Z");
        },
      },
    });

    const aggregate = await service.collect();
    expect(aggregate.generated_at).toBe("2027-01-15T03:01:00.000Z");
    expect(Date.parse(aggregate.generated_at)).toBeGreaterThanOrEqual(
      Date.parse(aggregate.observations[0]?.observation_timestamp ?? ""),
    );
  });
});
