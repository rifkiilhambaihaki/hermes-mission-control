import { createObservation, type Observation, type Provenance } from "../../domain/observation/observation.js";
import type {
  LocalHermesVersionMetadata,
  LocalVersionMetadataResult,
} from "./local-hermes-version-metadata-adapter.js";

export function localVersionMetadataResultToObservation(
  result: LocalVersionMetadataResult,
  provenance: Provenance,
): Observation<LocalHermesVersionMetadata> {
  if (result.availability === "AVAILABLE") {
    return createObservation<LocalHermesVersionMetadata>({
      availability: "AVAILABLE",
      reviewStatus: result.reviewStatus,
      completeness: "COMPLETE",
      freshness: "FRESH",
      provenance,
      confidence: {
        level: "HIGH",
        reasons: ["Approved local Hermes version metadata contract matched."],
      },
      current: result.current,
      error: null,
      lastKnownGood: null,
    });
  }

  if (result.availability === "UNAVAILABLE") {
    return createObservation<LocalHermesVersionMetadata>({
      availability: "UNAVAILABLE",
      reviewStatus: result.reviewStatus,
      completeness: "UNKNOWN",
      freshness: "UNKNOWN",
      provenance: null,
      confidence: { level: "NONE", reasons: ["Approved metadata file could not be read."] },
      current: null,
      error: {
        code: result.error.code,
        message: "The approved local Hermes version metadata source is unavailable.",
        retryable: result.error.retryable,
      },
      lastKnownGood: null,
    });
  }

  return createObservation<LocalHermesVersionMetadata>({
    availability: "UNKNOWN",
    reviewStatus: result.reviewStatus,
    completeness: "UNKNOWN",
    freshness: "UNKNOWN",
    provenance,
    confidence: { level: "NONE", reasons: ["Hermes version identity could not be established."] },
    current: null,
    error: {
      code: result.error.code,
      message: result.error.code === "VERSION_METADATA_MISMATCH"
        ? "Installed distribution and editable runtime source versions disagree."
        : "The approved local Hermes version metadata is invalid or incomplete.",
      retryable: result.error.retryable,
    },
    lastKnownGood: null,
  });
}
