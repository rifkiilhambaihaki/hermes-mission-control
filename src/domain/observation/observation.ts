import type { ReviewStatus, SnapshotStatus } from "../contracts/snapshot-types.js";
import type { Freshness } from "./freshness.js";

export type Availability = "AVAILABLE" | "EMPTY" | "STALE" | "UNAVAILABLE" | "UNKNOWN";
export type Completeness = "COMPLETE" | "PARTIAL" | "EMPTY" | "UNKNOWN";
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export interface Provenance {
  readonly source: string;
  readonly observedAt: string;
  readonly fetchedAt: string;
}

export interface Confidence {
  readonly level: ConfidenceLevel;
  readonly reasons: readonly string[];
}

export interface SanitizedError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface LastKnownGood<T> {
  readonly data: T;
  readonly provenance: Provenance;
  readonly freshness: Exclude<Freshness, "UNKNOWN">;
  readonly confidence: Confidence;
}

export interface Observation<T> {
  readonly availability: Availability;
  readonly reviewStatus: ReviewStatus;
  readonly completeness: Completeness;
  readonly freshness: Freshness;
  readonly provenance: Provenance | null;
  readonly confidence: Confidence;
  readonly current: T | null;
  readonly error: SanitizedError | null;
  readonly lastKnownGood: LastKnownGood<T> | null;
}

export interface SnapshotObservationInput<T> {
  readonly snapshotStatus: SnapshotStatus;
  readonly reviewStatus: ReviewStatus;
  readonly data: T | null;
  readonly provenance: Provenance;
  readonly freshness: Freshness;
  readonly confidence: Confidence;
}

export function observationInvariantViolations<T>(observation: Observation<T>): string[] {
  const violations: string[] = [];

  if (["UNAVAILABLE", "UNKNOWN"].includes(observation.availability) && observation.current !== null) {
    violations.push(`${observation.availability} observations must have null current data.`);
  }
  if (observation.availability === "AVAILABLE" && observation.current === null) {
    violations.push("AVAILABLE observations require current data.");
  }
  if (observation.availability === "EMPTY") {
    if (observation.current === null) {
      violations.push("EMPTY is a successful observation and requires an explicit empty representation.");
    }
    if (observation.completeness !== "EMPTY") {
      violations.push("EMPTY availability requires EMPTY completeness.");
    }
    if (observation.error !== null) {
      violations.push("EMPTY availability cannot carry an error.");
    }
  }
  if (observation.availability === "STALE" && observation.current === null && observation.lastKnownGood === null) {
    violations.push("STALE observations require current data or a separate last-known-good context.");
  }
  if (["UNAVAILABLE", "UNKNOWN"].includes(observation.availability) && observation.confidence.level !== "NONE") {
    violations.push(`${observation.availability} observations must not claim confidence.`);
  }
  if (observation.availability === "UNAVAILABLE" && observation.error === null) {
    violations.push("UNAVAILABLE observations require a sanitized transport error.");
  }
  if (observation.lastKnownGood !== null && "lastKnownGood" in Object(observation.lastKnownGood)) {
    violations.push("Last-known-good values must not be nested.");
  }

  return violations;
}

export function createObservation<T>(observation: Observation<T>): Observation<T> {
  const violations = observationInvariantViolations(observation);
  if (violations.length > 0) {
    throw new Error(violations.join(" "));
  }
  return observation;
}

export function observationFromSnapshot<T>(input: SnapshotObservationInput<T>): Observation<T> {
  if (input.snapshotStatus === "UNKNOWN") {
    return createObservation<T>({
      availability: "UNKNOWN",
      reviewStatus: input.reviewStatus,
      completeness: "UNKNOWN",
      freshness: "UNKNOWN",
      provenance: input.provenance,
      confidence: { level: "NONE", reasons: ["Snapshot declared UNKNOWN."] },
      current: null,
      error: null,
      lastKnownGood: null,
    });
  }

  if (input.data === null) {
    throw new Error(`${input.snapshotStatus} snapshots require a data representation.`);
  }

  if (input.snapshotStatus === "EMPTY") {
    return createObservation<T>({
      availability: "EMPTY",
      reviewStatus: input.reviewStatus,
      completeness: "EMPTY",
      freshness: input.freshness,
      provenance: input.provenance,
      confidence: input.confidence,
      current: input.data,
      error: null,
      lastKnownGood: null,
    });
  }

  return createObservation({
    availability: input.freshness === "STALE" || input.freshness === "EXPIRED" ? "STALE" : "AVAILABLE",
    reviewStatus: input.reviewStatus,
    completeness: "COMPLETE",
    freshness: input.freshness,
    provenance: input.provenance,
    confidence: input.confidence,
    current: input.data,
    error: null,
    lastKnownGood: null,
  });
}

export function unavailableObservation<T>(
  reviewStatus: ReviewStatus,
  error: SanitizedError,
  lastKnownGood: LastKnownGood<T> | null,
): Observation<T> {
  return createObservation({
    availability: "UNAVAILABLE",
    reviewStatus,
    completeness: "UNKNOWN",
    freshness: "UNKNOWN",
    provenance: null,
    confidence: { level: "NONE", reasons: ["Current transport attempt failed."] },
    current: null,
    error,
    lastKnownGood,
  });
}
