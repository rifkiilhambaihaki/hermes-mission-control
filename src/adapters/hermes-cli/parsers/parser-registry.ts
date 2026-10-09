import type { BoundedProcessResult, SuccessfulProcessResult } from "../runner/bounded-process-executor.js";
import {
  FROZEN_COMMAND_REGISTRY,
  type HermesCommandId,
} from "../runner/command-registry.js";
import {
  isParserCompatibilityAuthority,
  type ParserCompatibilityAuthority,
} from "../../hermes-version-metadata/compatibility-authority.js";
import { parserCompatibilityFor } from "./compatibility.js";
import {
  PARSER_COMMAND_IDS as PARSER_IDS,
  type AnyParserResult,
  type ParserCommandId,
} from "./contracts.js";
import { parseProfileListText } from "./profile-list-parser.js";
import { parserFailure } from "./result-builders.js";

export { PARSER_COMMAND_IDS } from "./contracts.js";

export interface ParserContext {
  readonly versionAuthority: ParserCompatibilityAuthority | null;
}

function isParserCommandId(commandId: HermesCommandId): commandId is ParserCommandId {
  return PARSER_IDS.includes(commandId as ParserCommandId);
}

function decodeStdout(result: SuccessfulProcessResult): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(result.rawStdout);
  } catch {
    return null;
  }
}

function appendStderrWarning(result: AnyParserResult, stderrBytes: number): AnyParserResult {
  if (!result.ok || stderrBytes === 0) return result;
  return {
    ...result,
    warnings: Object.freeze([...new Set([...result.warnings, "SOURCE_STDERR_DISCARDED" as const])]),
  } as AnyParserResult;
}

function parseSuccessfulResult(
  result: SuccessfulProcessResult & { readonly commandId: ParserCommandId },
  text: string,
): AnyParserResult {
  switch (result.commandId) {
    case "HERMES_PROFILE_LIST":
      return parseProfileListText(text);
  }
}

function sourceFormatFor(commandId: HermesCommandId): "HUMAN_TEXT" | "JSON" {
  return commandId === "HERMES_KANBAN_BOARDS" || commandId === "HERMES_KANBAN_BOARD_ITEMS"
    ? "JSON"
    : "HUMAN_TEXT";
}

export function parseHermesRunnerResult(
  result: BoundedProcessResult,
  context: ParserContext,
): AnyParserResult {
  if (!isParserCommandId(result.commandId)) {
    const errorCode =
      FROZEN_COMMAND_REGISTRY[result.commandId].capabilityStatus ===
      "RETIRED_FROM_LIVE_MONITORING"
        ? "COMMAND_RETIRED"
        : "COMMAND_NOT_LIVE_VALIDATED";
    return parserFailure(result.commandId, errorCode, sourceFormatFor(result.commandId));
  }
  const sourceFormat = sourceFormatFor(result.commandId);
  if (!("rawStdout" in result)) {
    if (result.category === "UNAVAILABLE") {
      return {
        ...parserFailure(result.commandId, "RUNNER_UNAVAILABLE", sourceFormat),
        runnerErrorCode: result.errorCode,
      } as AnyParserResult;
    }
    return parserFailure(result.commandId, "TRUNCATED_OUTPUT", sourceFormat) as AnyParserResult;
  }
  if (
    !isParserCompatibilityAuthority(context.versionAuthority) ||
    parserCompatibilityFor(context.versionAuthority.version, result.commandId) === null
  ) {
    return parserFailure(result.commandId, "UNSUPPORTED_VERSION", sourceFormat) as AnyParserResult;
  }
  const text = decodeStdout(result);
  if (text === null) {
    return parserFailure(result.commandId, "INVALID_STRUCTURE", sourceFormat) as AnyParserResult;
  }
  return appendStderrWarning(
    parseSuccessfulResult(
      result as SuccessfulProcessResult & { readonly commandId: ParserCommandId },
      text,
    ),
    result.stderrBytes,
  );
}
