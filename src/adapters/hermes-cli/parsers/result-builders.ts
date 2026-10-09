import type { HermesCommandId } from "../runner/command-registry.js";
import {
  PARSER_VERSION,
  type HermesNormalizedDataByCommand,
  type ParserCompleteness,
  type ParserFailureCode,
  type ParserResult,
  type ParserSourceFormat,
  type ParserWarning,
} from "./contracts.js";

export function parserFailure<K extends HermesCommandId>(
  commandId: K,
  errorCode: ParserFailureCode,
  sourceFormat: "HUMAN_TEXT" | "JSON" = "HUMAN_TEXT",
): ParserResult<K> {
  return {
    ok: false,
    commandId,
    errorCode,
    warnings: [],
    sanitizedMetadata: { sourceFormat, recordCount: 0 },
    parserVersion: PARSER_VERSION,
  } as unknown as ParserResult<K>;
}
export function parserSuccess<K extends HermesCommandId>(
  commandId: K,
  normalizedData: HermesNormalizedDataByCommand[K],
  completeness: ParserCompleteness,
  recordCount: number,
  warnings: readonly ParserWarning[] = [],
  sourceFormat: ParserSourceFormat = "HUMAN_TEXT",
): ParserResult<K> {
  return {
    ok: true,
    commandId,
    normalizedData,
    completeness,
    warnings: Object.freeze([...new Set(warnings)]),
    sanitizedMetadata: { sourceFormat, recordCount },
    parserVersion: PARSER_VERSION,
  } as unknown as ParserResult<K>;
}
