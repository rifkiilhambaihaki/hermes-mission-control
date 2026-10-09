import type { HermesCommandId } from "../runner/command-registry.js";
import {
  PARSER_COMMAND_IDS,
  PARSER_VERSION,
  type ParserCommandId,
  type ParserFailure,
  type ParserResult,
  type ParserSuccess,
} from "./contracts.js";
import { normalizeCliText } from "./sanitization.js";

export const SUPPORTED_HERMES_VERSION = "0.16.0" as const;

export interface ParserCompatibility {
  readonly parserVersion: typeof PARSER_VERSION;
  readonly commandIds: readonly ParserCommandId[];
}

export const PARSER_COMPATIBILITY_REGISTRY: Readonly<Record<typeof SUPPORTED_HERMES_VERSION, ParserCompatibility>> =
  Object.freeze({
    "0.16.0": Object.freeze({
      parserVersion: PARSER_VERSION,
      commandIds: Object.freeze([...PARSER_COMMAND_IDS]),
    }),
  });

function versionFailure(errorCode: ParserFailure<"HERMES_VERSION">["errorCode"]): ParserFailure<"HERMES_VERSION"> {
  return {
    ok: false,
    commandId: "HERMES_VERSION",
    errorCode,
    sanitizedMetadata: { sourceFormat: "HUMAN_TEXT", recordCount: 0 },
    parserVersion: PARSER_VERSION,
  };
}

export function parseHermesVersionText(text: string): ParserResult<"HERMES_VERSION"> {
  let normalized: string;
  try {
    normalized = normalizeCliText(text).trim().replace(/[ \t]+/g, " ");
  } catch {
    return versionFailure("INVALID_STRUCTURE");
  }
  const compact = normalized.trim().replace(/[ \t]+/g, " ");
  if (/\[(?:output )?truncated\]/i.test(compact)) return versionFailure("TRUNCATED_OUTPUT");
  const match = /^Hermes Agent (\d+\.\d+\.\d+)$/.exec(compact);
  if (match === null) return versionFailure("PARSER_MISMATCH");
  if (match[1] !== SUPPORTED_HERMES_VERSION) return versionFailure("UNSUPPORTED_VERSION");
  const success: ParserSuccess<"HERMES_VERSION"> = {
    ok: true,
    commandId: "HERMES_VERSION",
    normalizedData: { version: SUPPORTED_HERMES_VERSION },
    completeness: "COMPLETE",
    warnings: [],
    sanitizedMetadata: { sourceFormat: "HUMAN_TEXT", recordCount: 1 },
    parserVersion: PARSER_VERSION,
  };
  return success;
}

export function parserCompatibilityFor(
  version: string,
  commandId: HermesCommandId,
): ParserCompatibility | null {
  if (version !== SUPPORTED_HERMES_VERSION) return null;
  const compatibility = PARSER_COMPATIBILITY_REGISTRY[SUPPORTED_HERMES_VERSION];
  return compatibility.commandIds.includes(commandId as ParserCommandId) ? compatibility : null;
}
