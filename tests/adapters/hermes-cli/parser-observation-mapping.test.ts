import { describe, expect, it } from "vitest";

import { parserResultToObservation } from "../../../src/adapters/hermes-cli/parsers/observation-mapping.js";
import type { ParserResult } from "../../../src/adapters/hermes-cli/parsers/contracts.js";

const provenance = {
  source: "HERMES_PROFILE_LIST",
  observedAt: "2027-01-01T00:00:00.000Z",
  fetchedAt: "2027-01-01T00:00:01.000Z",
};

describe("parser result to Observation mapping", () => {
  it.each([
    ["COMPLETE", "AVAILABLE"],
    ["PARTIAL", "AVAILABLE"],
    ["EMPTY", "EMPTY"],
  ] as const)("maps usable %s data to %s", (completeness, availability) => {
    const result: ParserResult<"HERMES_VERSION"> = {
      ok: true,
      commandId: "HERMES_VERSION",
      normalizedData: { version: "0.16.0" },
      completeness,
      warnings: [],
      sanitizedMetadata: { sourceFormat: "HUMAN_TEXT", recordCount: completeness === "EMPTY" ? 0 : 1 },
      parserVersion: "1.0.0",
    };
    expect(parserResultToObservation(result, provenance)).toMatchObject({
      availability,
      completeness,
      current: result.normalizedData,
      error: null,
      lastKnownGood: null,
    });
  });

  it("maps gateway service-definition warnings to REVIEW_REQUIRED without collapsing dimensions", () => {
    const result: ParserResult<"HERMES_GATEWAY_STATUS"> = {
      ok: true,
      commandId: "HERMES_GATEWAY_STATUS",
      normalizedData: {
        processState: "RUNNING",
        processIdentityConsistency: "UNKNOWN",
        processMode: "MANAGED",
        systemServiceState: "ACTIVE",
        userServiceState: "INACTIVE",
        managerCategory: "UNKNOWN",
        duplicateDefinitionState: "UNKNOWN",
        telegramConnectivity: "CONNECTED",
        serviceDefinitionState: "OUTDATED",
      },
      completeness: "COMPLETE",
      warnings: [],
      sanitizedMetadata: { sourceFormat: "HUMAN_TEXT", recordCount: 1 },
      parserVersion: "1.0.0",
    };
    expect(parserResultToObservation(result, provenance)).toMatchObject({
      availability: "AVAILABLE",
      reviewStatus: "REVIEW_REQUIRED",
      current: {
        processState: "RUNNING",
        systemServiceState: "ACTIVE",
        userServiceState: "INACTIVE",
        serviceDefinitionState: "OUTDATED",
      },
    });
  });

  it.each([
    "COMMAND_RETIRED",
    "COMMAND_NOT_LIVE_VALIDATED",
    "PARSER_MISMATCH",
    "TRUNCATED_OUTPUT",
    "UNSUPPORTED_VERSION",
    "INVALID_JSON",
    "INVALID_STRUCTURE",
  ] as const)(
    "maps %s to UNKNOWN, never EMPTY",
    (errorCode) => {
      const result: ParserResult<"HERMES_VERSION"> = {
        ok: false,
        commandId: "HERMES_VERSION",
        errorCode,
        parserVersion: "1.0.0",
        sanitizedMetadata: { sourceFormat: "HUMAN_TEXT", recordCount: 0 },
      };
      expect(parserResultToObservation(result, provenance)).toMatchObject({
        availability: "UNKNOWN",
        completeness: "UNKNOWN",
        current: null,
        error: { code: errorCode },
      });
    },
  );

  it.each(["TIMEOUT", "EXECUTABLE_NOT_FOUND", "PERMISSION_DENIED"] as const)(
    "maps runner %s to UNAVAILABLE",
    (runnerErrorCode) => {
      const result: ParserResult<"HERMES_VERSION"> = {
        ok: false,
        commandId: "HERMES_VERSION",
        errorCode: "RUNNER_UNAVAILABLE",
        runnerErrorCode,
        parserVersion: "1.0.0",
        sanitizedMetadata: { sourceFormat: "HUMAN_TEXT", recordCount: 0 },
      };
      expect(parserResultToObservation(result, provenance)).toMatchObject({
        availability: "UNAVAILABLE",
        current: null,
        error: { code: runnerErrorCode, retryable: true },
      });
    },
  );
});
