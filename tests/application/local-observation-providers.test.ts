import { describe, expect, it } from "vitest";

import {
  createLocalObservationProviders,
  type LocalGatewayAdapterPort,
  type LocalSchedulerAdapterPort,
} from "../../src/infrastructure/observations/local-observation-providers.js";
import { ObservationService } from "../../src/application/observations/observation-service.js";
import { createObservation } from "../../src/domain/observation/observation.js";

const fixedTime = "2027-01-15T03:00:00.000Z";

function gatewayObservation() {
  return createObservation({
    availability: "AVAILABLE" as const,
    reviewStatus: "NONE" as const,
    completeness: "PARTIAL" as const,
    freshness: "FRESH" as const,
    provenance: { source: "HERMES_GATEWAY_LOCAL", observedAt: fixedTime, fetchedAt: fixedTime },
    confidence: { level: "MEDIUM" as const, reasons: ["Synthetic adapter."] },
    current: {
      processState: "RUNNING" as const,
      processIdentityConsistency: "CONSISTENT" as const,
      processMode: "UNKNOWN" as const,
      userServiceState: "UNKNOWN" as const,
      systemServiceState: "UNKNOWN" as const,
      managerCategory: "UNKNOWN" as const,
      duplicateDefinitionState: "UNKNOWN" as const,
      serviceDefinitionState: "UNKNOWN" as const,
    },
    error: null,
    lastKnownGood: null,
  });
}

function schedulerObservation() {
  return createObservation({
    availability: "AVAILABLE" as const,
    reviewStatus: "NONE" as const,
    completeness: "COMPLETE" as const,
    freshness: "FRESH" as const,
    provenance: { source: "HERMES_SCHEDULER_LOCAL", observedAt: fixedTime, fetchedAt: fixedTime },
    confidence: { level: "HIGH" as const, reasons: ["Synthetic adapter."] },
    current: {
      schedulerAvailability: "AVAILABLE" as const,
      enabledJobCount: 2,
      totalJobCount: 3,
    },
    error: null,
    lastKnownGood: null,
  });
}

describe("local observation provider composition", () => {
  it("invokes only the approved Version, Gateway, and Scheduler adapter ports", async () => {
    let versionCalls = 0;
    const gatewayRequests: unknown[] = [];
    const schedulerRequests: unknown[] = [];
    const gatewayAdapter: LocalGatewayAdapterPort = {
      observe: async (request) => {
        gatewayRequests.push(request);
        return gatewayObservation();
      },
    };
    const schedulerAdapter: LocalSchedulerAdapterPort = {
      observe: async (request) => {
        schedulerRequests.push(request);
        return schedulerObservation();
      },
    };
    const providers = createLocalObservationProviders({
      clock: () => new Date(fixedTime),
      staleAfterMs: 30_000,
      expiredAfterMs: 60_000,
      versionAdapter: {
        read: async () => {
          versionCalls += 1;
          return {
            availability: "AVAILABLE",
            reviewStatus: "NONE",
            current: {
              version: "0.16.0",
              installationKind: "INSTALLED",
              authority: "INSTALLED_DISTRIBUTION",
              consistencyStatus: "NOT_REQUIRED",
              compatibilityStatus: "SUPPORTED",
              adapterVersion: "1.0.0",
            },
            error: null,
          };
        },
      },
      gatewayAdapter,
      schedulerAdapter,
    });
    const aggregate = await new ObservationService({
      clock: () => new Date(fixedTime),
      providers,
    }).collect();

    expect(versionCalls).toBe(1);
    expect(gatewayRequests).toEqual([{
      source: "HERMES_GATEWAY_LOCAL",
      observedAt: fixedTime,
      fetchedAt: fixedTime,
      asOf: fixedTime,
      staleAfterMs: 30_000,
      expiredAfterMs: 60_000,
    }]);
    expect(schedulerRequests).toEqual([{
      source: "HERMES_SCHEDULER_LOCAL",
      observedAt: fixedTime,
      fetchedAt: fixedTime,
      asOf: fixedTime,
      staleAfterMs: 30_000,
      expiredAfterMs: 60_000,
    }]);
    expect(aggregate.observations.slice(0, 4).map((slot) => [slot.source, slot.availability])).toEqual([
      ["HERMES_VERSION", "AVAILABLE"],
      ["HERMES_PROFILE", "UNKNOWN"],
      ["HERMES_GATEWAY", "AVAILABLE"],
      ["HERMES_SCHEDULER", "AVAILABLE"],
    ]);
  });

  it("rejects invalid freshness thresholds before constructing providers", () => {
    expect(() => createLocalObservationProviders({
      clock: () => new Date(fixedTime),
      staleAfterMs: 60_000,
      expiredAfterMs: 30_000,
      versionAdapter: { read: async () => { throw new Error("not called"); } },
      gatewayAdapter: { observe: async () => { throw new Error("not called"); } },
      schedulerAdapter: { observe: async () => { throw new Error("not called"); } },
    })).toThrow("freshness thresholds");
  });
});
