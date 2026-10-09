import { createObservation, type Observation, type Provenance } from "../../../domain/observation/observation.js";
import type { HermesCommandId } from "../runner/command-registry.js";
import type { HermesNormalizedDataByCommand, ParserResult } from "./contracts.js";

const RETRYABLE_RUNNER_ERRORS = new Set(["TIMEOUT", "EXECUTABLE_NOT_FOUND", "PERMISSION_DENIED", "SPAWN_FAILED"]);

export function parserResultToObservation<K extends HermesCommandId>(
  result: ParserResult<K>,
  provenance: Provenance,
): Observation<HermesNormalizedDataByCommand[K]> {
  if (result.ok) {
    const gatewayNeedsReview =
      result.commandId === "HERMES_GATEWAY_STATUS" &&
      "serviceDefinitionState" in result.normalizedData &&
      ["OUTDATED", "REVIEW_REQUIRED"].includes(result.normalizedData.serviceDefinitionState);
    return createObservation<HermesNormalizedDataByCommand[K]>({
      availability: result.completeness === "EMPTY" ? "EMPTY" : "AVAILABLE",
      reviewStatus: gatewayNeedsReview ? "REVIEW_REQUIRED" : "NONE",
      completeness: result.completeness,
      freshness: "FRESH",
      provenance,
      confidence: {
        level: result.completeness === "PARTIAL" ? "MEDIUM" : "HIGH",
        reasons: result.warnings.length === 0 ? ["Parser contract matched."] : [...result.warnings],
      },
      current: result.normalizedData as unknown as HermesNormalizedDataByCommand[K],
      error: null,
      lastKnownGood: null,
    });
  }

  if (result.errorCode === "RUNNER_UNAVAILABLE") {
    const code = result.runnerErrorCode ?? "SPAWN_FAILED";
    return createObservation<HermesNormalizedDataByCommand[K]>({
      availability: "UNAVAILABLE",
      reviewStatus: "NONE",
      completeness: "UNKNOWN",
      freshness: "UNKNOWN",
      provenance: null,
      confidence: { level: "NONE", reasons: ["Runner transport failed."] },
      current: null,
      error: {
        code,
        message: "The Hermes source is currently unavailable.",
        retryable: RETRYABLE_RUNNER_ERRORS.has(code),
      },
      lastKnownGood: null,
    });
  }

  return createObservation<HermesNormalizedDataByCommand[K]>({
    availability: "UNKNOWN",
    reviewStatus: "REVIEW_REQUIRED",
    completeness: "UNKNOWN",
    freshness: "UNKNOWN",
    provenance,
    confidence: { level: "NONE", reasons: ["Parser contract did not produce usable data."] },
    current: null,
    error: {
      code: result.errorCode,
      message: "The Hermes output did not match an approved parser contract.",
      retryable: false,
    },
    lastKnownGood: null,
  });
}
