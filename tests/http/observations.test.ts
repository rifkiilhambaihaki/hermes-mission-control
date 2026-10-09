import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import {
  ObservationService,
  OBSERVATION_SOURCE_IDS,
  type ObservationProviderMap,
} from "../../src/application/observations/observation-service.js";
import { createObservation, type Observation } from "../../src/domain/observation/observation.js";
import {
  DEFAULT_HTTP_SCHEMAS,
  createApplication,
  type ApplicationConfig,
} from "../../src/http/application.js";
import { encodePasswordHash } from "../../src/security/scrypt-password.js";

const fixedTime = "2027-01-15T03:00:00.000Z";
const username = "synthetic-user";
const password = "Synthetic-Password-Only";
let passwordHash = "";
const applications: FastifyInstance[] = [];

function authorization(): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function config(): ApplicationConfig {
  return {
    applicationName: "Hermes Mission Control",
    applicationVersion: "0.1.0-test",
    buildId: "synthetic-local",
    apiVersion: "v1",
    bindAddress: "127.0.0.1",
    basicUsername: username,
    basicPasswordHash: passwordHash,
  };
}

function available<T>(source: string, current: T): Observation<T> {
  return createObservation({
    availability: "AVAILABLE",
    reviewStatus: "NONE",
    completeness: "COMPLETE",
    freshness: "FRESH",
    provenance: { source, observedAt: fixedTime, fetchedAt: fixedTime },
    confidence: { level: "HIGH", reasons: ["Synthetic approved source."] },
    current,
    error: null,
    lastKnownGood: null,
  });
}

function stale<T>(source: string, current: T): Observation<T> {
  return createObservation({
    availability: "STALE",
    reviewStatus: "REVIEW_REQUIRED",
    completeness: "COMPLETE",
    freshness: "STALE",
    provenance: {
      source,
      observedAt: "2027-01-01T00:00:00.000Z",
      fetchedAt: "2027-01-01T00:00:00.000Z",
    },
    confidence: { level: "LOW", reasons: ["Synthetic stale source."] },
    current,
    error: null,
    lastKnownGood: null,
  });
}

function unknown<T>(source: string): Observation<T> {
  return createObservation<T>({
    availability: "UNKNOWN",
    reviewStatus: "REVIEW_REQUIRED",
    completeness: "UNKNOWN",
    freshness: "UNKNOWN",
    provenance: { source, observedAt: fixedTime, fetchedAt: fixedTime },
    confidence: { level: "NONE", reasons: ["Synthetic uncertainty."] },
    current: null as T | null,
    error: null,
    lastKnownGood: null,
  });
}

function empty<T>(source: string, current: T): Observation<T> {
  return createObservation({
    availability: "EMPTY",
    reviewStatus: "NONE",
    completeness: "EMPTY",
    freshness: "FRESH",
    provenance: { source, observedAt: fixedTime, fetchedAt: fixedTime },
    confidence: { level: "HIGH", reasons: ["Synthetic empty source."] },
    current,
    error: null,
    lastKnownGood: null,
  });
}

function allAvailableProviders(): ObservationProviderMap {
  return {
    HERMES_VERSION: async () => available("HERMES_VERSION_METADATA", {
      version: "0.16.0",
      installationKind: "EDITABLE",
      authority: "INSTALLED_DISTRIBUTION_CONFIRMED_BY_RUNTIME_SOURCE",
      consistencyStatus: "MATCHED",
      compatibilityStatus: "SUPPORTED",
      adapterVersion: "1.0.0",
      rawPath: "/privacy/path-canary",
    }),
    HERMES_PROFILE: async () => available("HERMES_PROFILE_TRUSTED", {
      profiles: [
        { name: "default", current: true, token: "TOKEN-CANARY" },
        { name: "private-profile-identifier", current: false },
      ],
    }),
    HERMES_GATEWAY: async () => available("HERMES_GATEWAY_LOCAL", {
      processState: "RUNNING",
      processIdentityConsistency: "CONSISTENT",
      processMode: "UNKNOWN",
      userServiceState: "UNKNOWN",
      systemServiceState: "UNKNOWN",
      managerCategory: "UNKNOWN",
      duplicateDefinitionState: "UNKNOWN",
      serviceDefinitionState: "UNKNOWN",
      internalPid: 4242,
    }),
    HERMES_SCHEDULER: async () => available("HERMES_SCHEDULER_LOCAL", {
      schedulerAvailability: "AVAILABLE",
      enabledJobCount: 2,
      totalJobCount: 3,
      prompt: "PROMPT-CANARY",
      destination: "TELEGRAM-DESTINATION-CANARY",
    }),
    ACCOUNTING_V2: async () => available("ACCOUNTING_V2", {
      summary: {
        income_idr: 10_000,
        expense_idr: 4_000,
        total_cash_outflow_idr: 5_000,
        operational_surplus_idr: 6_000,
        net_cash_surplus_idr: 5_000,
        transaction_count: 3,
      },
      category_details: {
        items: [{ category_ref: "PRIVATE-CATEGORY-ID", amount_idr: 4_000, transaction_count: 1 }],
      },
    }),
    BANK_JOURNAL: async () => available("BANK_JOURNAL_QUALITY", {
      summary: {
        quality_issue_count: 1,
        unresolved_mapping_count: 1,
        incomplete_evidence_count: 0,
        external_metadata_stale_count: 0,
        source_conflict_count: 0,
      },
      issue_details: { items: [{ paper_ref: "PRIVATE-PAPER-ID", subject_ref: "PRIVATE-SUBJECT-ID" }] },
    }),
    SUBMISSION_TRACKER: async () => available("SUBMISSION_TRACKER", {
      summary: {
        total_count: 2,
        active_count: 1,
        revision_requested_count: 1,
        accepted_count: 0,
        rejected_count: 0,
        no_next_action_count: 1,
      },
      paper_details: { items: [{ paper_ref: "PRIVATE-SUBMISSION-ID" }] },
    }),
  };
}

async function app(options: {
  readonly providers?: Partial<ObservationProviderMap>;
  readonly logLines?: string[];
  readonly schemas?: typeof DEFAULT_HTTP_SCHEMAS;
  readonly observationResponseFactory?: (result: unknown) => unknown;
} = {}): Promise<FastifyInstance> {
  const observationService = new ObservationService({
    clock: () => new Date(fixedTime),
    providers: options.providers ?? {},
  });
  const instance = await createApplication({
    config: config(),
    dependencies: {
      clock: () => new Date(fixedTime),
      sleep: async () => undefined,
      logStream: { write: (line) => { options.logLines?.push(line); } },
      ...(options.schemas === undefined ? {} : { schemas: options.schemas }),
      observationService,
      ...(options.observationResponseFactory === undefined
        ? {}
        : { observationResponseFactory: options.observationResponseFactory }),
    },
  });
  applications.push(instance);
  return instance;
}

async function getObservations(instance: FastifyInstance) {
  return instance.inject({
    method: "GET",
    url: "/api/v1/observations",
    headers: { authorization: authorization() },
  });
}

beforeAll(async () => {
  passwordHash = await encodePasswordHash(password, Buffer.alloc(16, 0x55));
});

afterEach(async () => {
  await Promise.all(applications.splice(0).map(async (instance) => instance.close()));
});

describe("authenticated seven-source observation API", () => {
  it("returns all seven AVAILABLE sources in the frozen order with sanitized projections", async () => {
    const response = await getObservations(await app({ providers: allAvailableProviders() }));
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json();
    expect(body.contract_version).toBe("1.0.0");
    expect(body.generated_at).toBe(fixedTime);
    expect(body.observations.map((slot: { source: string }) => slot.source)).toEqual(OBSERVATION_SOURCE_IDS);
    expect(body.observations.every((slot: { availability: string }) => slot.availability === "AVAILABLE")).toBe(true);
    expect(body.observations.find((slot: { source: string }) => slot.source === "HERMES_PROFILE").current).toEqual({
      profile_count: 2,
      current_profile_count: 1,
    });
    expect(body.observations.find((slot: { source: string }) => slot.source === "HERMES_SCHEDULER").current).toEqual({
      scheduler_availability: "AVAILABLE",
      enabled_job_count: 2,
      total_job_count: 3,
    });
    const serialized = JSON.stringify(body);
    for (const canary of [
      "/privacy/path-canary",
      "TOKEN-CANARY",
      "private-profile-identifier",
      "4242",
      "PROMPT-CANARY",
      "TELEGRAM-DESTINATION-CANARY",
      "PRIVATE-CATEGORY-ID",
      "PRIVATE-PAPER-ID",
      "PRIVATE-SUBJECT-ID",
      "PRIVATE-SUBMISSION-ID",
    ]) expect(serialized).not.toContain(canary);
  });

  it("isolates mixed AVAILABLE, UNKNOWN, UNAVAILABLE, and EMPTY sources", async () => {
    const providers: Partial<ObservationProviderMap> = {
      HERMES_VERSION: allAvailableProviders().HERMES_VERSION,
      HERMES_GATEWAY: async () => unknown("HERMES_GATEWAY_LOCAL"),
      HERMES_SCHEDULER: async () => empty("HERMES_SCHEDULER_LOCAL", {
        schedulerAvailability: "EMPTY",
        enabledJobCount: 0,
        totalJobCount: 0,
      }),
      ACCOUNTING_V2: async () => {
        throw new Error("SOURCE-ERROR-PRIVATE-PATH-/not/public");
      },
    };
    const response = await getObservations(await app({ providers }));
    expect(response.statusCode).toBe(200);
    const slots = Object.fromEntries(response.json().observations.map((slot: { source: string }) => [slot.source, slot]));
    expect(slots.HERMES_VERSION.availability).toBe("AVAILABLE");
    expect(slots.HERMES_PROFILE).toMatchObject({
      availability: "UNKNOWN",
      current: null,
      error_code: "INTEGRATION_PENDING",
      observation_timestamp: null,
    });
    expect(slots.HERMES_GATEWAY).toMatchObject({ availability: "UNKNOWN", current: null });
    expect(slots.HERMES_SCHEDULER).toMatchObject({
      availability: "EMPTY",
      completeness: "EMPTY",
      current: { scheduler_availability: "EMPTY", enabled_job_count: 0, total_job_count: 0 },
    });
    expect(slots.ACCOUNTING_V2).toMatchObject({
      availability: "UNAVAILABLE",
      current: null,
      error_code: "SOURCE_OBSERVATION_FAILED",
    });
    expect(slots.BANK_JOURNAL.availability).toBe("UNKNOWN");
    expect(slots.SUBMISSION_TRACKER.availability).toBe("UNKNOWN");
    expect(response.body).not.toContain("SOURCE-ERROR-PRIVATE-PATH");
  });

  it("does not turn Scheduler intent counts into a runtime-health claim", async () => {
    const response = await getObservations(await app({
      providers: {
        HERMES_SCHEDULER: async () => available("HERMES_SCHEDULER_LOCAL", {
          schedulerAvailability: "AVAILABLE",
          enabledJobCount: 9,
          totalJobCount: 10,
        }),
      },
    }));
    const scheduler = response.json().observations.find((slot: { source: string }) => slot.source === "HERMES_SCHEDULER");
    expect(scheduler.current).toEqual({
      scheduler_availability: "AVAILABLE",
      enabled_job_count: 9,
      total_job_count: 10,
    });
    expect(JSON.stringify(scheduler).toLowerCase()).not.toMatch(/healthy|daemon|execution|success/);
  });

  it("preserves Gateway UNKNOWN without making a false STOPPED claim", async () => {
    const response = await getObservations(await app({
      providers: {
        HERMES_GATEWAY: async () => available("HERMES_GATEWAY_LOCAL", {
          processState: "UNKNOWN",
          processIdentityConsistency: "UNKNOWN",
          processMode: "UNKNOWN",
          userServiceState: "UNKNOWN",
          systemServiceState: "UNKNOWN",
          managerCategory: "UNKNOWN",
          duplicateDefinitionState: "UNKNOWN",
          serviceDefinitionState: "UNKNOWN",
        }),
      },
    }));
    const gateway = response.json().observations.find((slot: { source: string }) => slot.source === "HERMES_GATEWAY");
    expect(gateway.current.process_state).toBe("UNKNOWN");
    expect(gateway.current.process_identity_consistency).toBe("UNKNOWN");
    expect(JSON.stringify(gateway)).not.toContain("STOPPED");
  });

  it("preserves explicit stale freshness and original observation timestamp", async () => {
    const response = await getObservations(await app({
      providers: {
        HERMES_VERSION: async () => stale("HERMES_VERSION_METADATA", {
          version: "0.16.0",
          installationKind: "INSTALLED",
          authority: "INSTALLED_DISTRIBUTION",
          consistencyStatus: "NOT_REQUIRED",
          compatibilityStatus: "SUPPORTED",
          adapterVersion: "1.0.0",
        }),
      },
    }));
    const version = response.json().observations[0];
    expect(version).toMatchObject({
      availability: "STALE",
      freshness: "STALE",
      review_status: "REVIEW_REQUIRED",
      observation_timestamp: "2027-01-01T00:00:00.000Z",
    });
  });

  it("does not execute a Profile fallback when no trusted observation is provided", async () => {
    let unrelatedProviderCalls = 0;
    const response = await getObservations(await app({
      providers: {
        HERMES_VERSION: async () => {
          unrelatedProviderCalls += 1;
          return allAvailableProviders().HERMES_VERSION();
        },
      },
    }));
    expect(response.statusCode).toBe(200);
    const profile = response.json().observations.find((slot: { source: string }) => slot.source === "HERMES_PROFILE");
    expect(profile).toMatchObject({ availability: "UNKNOWN", error_code: "INTEGRATION_PENDING" });
    expect(unrelatedProviderCalls).toBe(1);
  });

  it("isolates schema-incompatible timestamps and bounded Version fields to their source slots", async () => {
    const invalidTimestamp = available("HERMES_VERSION_METADATA", {
      version: "0.16.0",
      installationKind: "INSTALLED",
      authority: "INSTALLED_DISTRIBUTION",
      consistencyStatus: "NOT_REQUIRED",
      compatibilityStatus: "SUPPORTED",
      adapterVersion: "1.0.0",
    });
    const response = await getObservations(await app({
      providers: {
        HERMES_VERSION: async () => ({
          ...invalidTimestamp,
          provenance: {
            source: "HERMES_VERSION_METADATA",
            observedAt: "2027-02-30T00:00:00Z",
            fetchedAt: "2027-02-30T00:00:00Z",
          },
        }),
        HERMES_PROFILE: async () => available("HERMES_PROFILE_TRUSTED", { profiles: [] }),
      },
    }));
    expect(response.statusCode).toBe(200);
    expect(response.json().observations[0]).toMatchObject({
      availability: "UNKNOWN",
      error_code: "INVALID_OBSERVATION_CONTRACT",
      current: null,
    });
    expect(response.json().observations[1].availability).toBe("AVAILABLE");

    const oversized = await getObservations(await app({
      providers: {
        HERMES_VERSION: async () => available("HERMES_VERSION_METADATA", {
          version: `0.16.0+${"x".repeat(90)}`,
          installationKind: "INSTALLED",
          authority: "INSTALLED_DISTRIBUTION",
          consistencyStatus: "NOT_REQUIRED",
          compatibilityStatus: "SUPPORTED",
          adapterVersion: "1.0.0",
        }),
      },
    }));
    expect(oversized.statusCode).toBe(200);
    expect(oversized.json().observations[0]).toMatchObject({
      availability: "UNKNOWN",
      error_code: "INVALID_OBSERVATION_CONTRACT",
      current: null,
    });
  });

  it("isolates invalid source data as UNKNOWN instead of failing the aggregate", async () => {
    const response = await getObservations(await app({
      providers: {
        HERMES_VERSION: async () => available("HERMES_VERSION_METADATA", {
          version: "not-a-version",
          internal_path: "/invalid/private/path",
        }),
        HERMES_SCHEDULER: allAvailableProviders().HERMES_SCHEDULER,
      },
    }));
    expect(response.statusCode).toBe(200);
    const slots = response.json().observations;
    expect(slots[0]).toMatchObject({
      source: "HERMES_VERSION",
      availability: "UNKNOWN",
      error_code: "INVALID_OBSERVATION_CONTRACT",
      current: null,
    });
    expect(slots.find((slot: { source: string }) => slot.source === "HERMES_SCHEDULER").availability).toBe("AVAILABLE");
    expect(response.body).not.toContain("invalid/private/path");
  });

  it("rejects unauthenticated access and accepts valid Basic Authentication", async () => {
    const instance = await app();
    const unauthorized = await instance.inject({ method: "GET", url: "/api/v1/observations" });
    expect(unauthorized.statusCode).toBe(401);
    const authorized = await getObservations(instance);
    expect(authorized.statusCode).toBe(200);
  });

  it("rejects unsupported mutation methods on the observation endpoint", async () => {
    const instance = await app();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const response = await instance.inject({
        method,
        url: "/api/v1/observations",
        headers: { authorization: authorization() },
      });
      expect(response.statusCode).toBe(405);
      expect(response.headers.allow).toBe("GET, HEAD");
    }
  });

  it("does not leak rejected source errors into response or logs", async () => {
    const logLines: string[] = [];
    const secret = "TOKEN-AND-PATH-CANARY-/secret/location";
    const response = await getObservations(await app({
      logLines,
      providers: {
        HERMES_GATEWAY: async () => {
          throw new Error(secret);
        },
      },
    }));
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(secret);
    expect(logLines.join("\n")).not.toContain(secret);
  });

  it("fails closed when the aggregate response factory violates the strict schema", async () => {
    const instance = await app({
      providers: allAvailableProviders(),
      observationResponseFactory: (result) => ({
        ...(result as Record<string, unknown>),
        prohibited_path: "/must/not/serialize",
      }),
    });
    const response = await getObservations(instance);
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "An internal error occurred.",
      status_code: 500,
    });
    expect(response.body).not.toContain("prohibited_path");
    expect(response.body).not.toContain("must/not/serialize");
  });

  it("fails application startup when the aggregate response schema is invalid", async () => {
    await expect(createApplication({
      config: config(),
      dependencies: {
        schemas: {
          ...DEFAULT_HTTP_SCHEMAS,
          observations: { type: "not-a-json-schema-type" },
        },
      },
    })).rejects.toThrow();
  });
});
