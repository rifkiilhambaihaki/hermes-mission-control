import { describe, expect, it } from "vitest";

import {
  createObservation,
  observationFromSnapshot,
  observationInvariantViolations,
  unavailableObservation,
  type LastKnownGood,
  type Observation,
  type Provenance,
} from "../../src/domain/observation/observation.js";

const provenance: Provenance = {
  source: "SYNTHETIC_SOURCE",
  observedAt: "2026-10-20T08:00:00+07:00",
  fetchedAt: "2026-10-20T09:00:00+07:00",
};

const confidence = { level: "HIGH", reasons: ["Synthetic authoritative fixture."] } as const;

describe("Observation invariants", () => {
  it("maps snapshot UNKNOWN to Observation UNKNOWN with null current data", () => {
    const observation = observationFromSnapshot({
      snapshotStatus: "UNKNOWN",
      reviewStatus: "REVIEW_REQUIRED",
      data: null,
      provenance,
      freshness: "UNKNOWN",
      confidence,
    });
    expect(observation.availability).toBe("UNKNOWN");
    expect(observation.current).toBeNull();
    expect(observation.reviewStatus).toBe("REVIEW_REQUIRED");
    expect(observation.confidence.level).toBe("NONE");
  });

  it("treats EMPTY as a successful authoritative observation", () => {
    const emptyData: readonly string[] = [];
    const observation = observationFromSnapshot({
      snapshotStatus: "EMPTY",
      reviewStatus: "NONE",
      data: emptyData,
      provenance,
      freshness: "FRESH",
      confidence,
    });
    expect(observation.availability).toBe("EMPTY");
    expect(observation.current).toEqual([]);
    expect(observation.error).toBeNull();
  });

  it("keeps REVIEW_REQUIRED orthogonal to availability", () => {
    const observation = observationFromSnapshot({
      snapshotStatus: "AVAILABLE",
      reviewStatus: "REVIEW_REQUIRED",
      data: { aggregate: 1 },
      provenance,
      freshness: "FRESH",
      confidence,
    });
    expect(observation.availability).toBe("AVAILABLE");
    expect(observation.reviewStatus).toBe("REVIEW_REQUIRED");
  });

  it("maps missing transport to UNAVAILABLE without snapshot self-declaration", () => {
    const observation = unavailableObservation<{ aggregate: number }>(
      "NONE",
      { code: "TRANSPORT_MISSING", message: "Sanitized transport failure.", retryable: true },
      null,
    );
    expect(observation.availability).toBe("UNAVAILABLE");
    expect(observation.current).toBeNull();
    expect(observation.confidence.level).toBe("NONE");
  });

  it("keeps failed current attempt separate from last-known-good", () => {
    const lastKnownGood: LastKnownGood<{ aggregate: number }> = {
      data: { aggregate: 7 },
      provenance,
      freshness: "STALE",
      confidence: { level: "MEDIUM", reasons: ["Previous valid observation."] },
    };
    const observation = unavailableObservation(
      "REVIEW_REQUIRED",
      { code: "TRANSPORT_FAILED", message: "Sanitized failure.", retryable: true },
      lastKnownGood,
    );
    expect(observation.current).toBeNull();
    expect(observation.lastKnownGood?.data).toEqual({ aggregate: 7 });
  });

  it("allows STALE to carry normalized last valid context", () => {
    const observation = createObservation<{ aggregate: number }>({
      availability: "STALE",
      reviewStatus: "NONE",
      completeness: "COMPLETE",
      freshness: "STALE",
      provenance,
      confidence: { level: "MEDIUM", reasons: ["Age exceeded stale threshold."] },
      current: { aggregate: 4 },
      error: null,
      lastKnownGood: null,
    });
    expect(observation.availability).toBe("STALE");
  });

  it("rejects unavailable as zero and unknown as healthy", () => {
    const unavailableAsZero = {
      availability: "UNAVAILABLE",
      reviewStatus: "NONE",
      completeness: "UNKNOWN",
      freshness: "UNKNOWN",
      provenance: null,
      confidence: { level: "NONE", reasons: [] },
      current: 0,
      error: { code: "FAILED", message: "Sanitized failure.", retryable: true },
      lastKnownGood: null,
    } satisfies Observation<number>;
    expect(observationInvariantViolations(unavailableAsZero)).toContain(
      "UNAVAILABLE observations must have null current data.",
    );

    const unknownAsHealthy = {
      ...unavailableAsZero,
      availability: "UNKNOWN",
      current: null,
      error: null,
      confidence: { level: "HIGH", reasons: ["Incorrect confidence."] },
    } satisfies Observation<number>;
    expect(observationInvariantViolations(unknownAsHealthy)).toContain(
      "UNKNOWN observations must not claim confidence.",
    );
  });

  it("rejects nested last-known-good structures", () => {
    const nested = {
      data: { aggregate: 1 },
      provenance,
      freshness: "STALE",
      confidence: { level: "LOW", reasons: [] },
      lastKnownGood: { prohibited: true },
    } as unknown as LastKnownGood<{ aggregate: number }>;
    const observation: Observation<{ aggregate: number }> = {
      availability: "UNAVAILABLE",
      reviewStatus: "NONE",
      completeness: "UNKNOWN",
      freshness: "UNKNOWN",
      provenance: null,
      confidence: { level: "NONE", reasons: [] },
      current: null,
      error: { code: "FAILED", message: "Sanitized failure.", retryable: true },
      lastKnownGood: nested,
    };
    expect(observationInvariantViolations(observation)).toContain(
      "Last-known-good values must not be nested.",
    );
  });
});
