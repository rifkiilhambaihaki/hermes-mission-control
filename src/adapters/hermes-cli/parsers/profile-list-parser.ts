import type { ParserResult, ProfileSummary } from "./contracts.js";
import { parserFailure, parserSuccess } from "./result-builders.js";

/**
 * Hermes 0.16.0 `hermes profile list` formatter contract.
 *
 * The upstream widths are minimum widths, except Model and Distribution are
 * truncated before formatting. Profile and Alias may exceed their minimum
 * widths, so rows are parsed from their constrained anchors rather than by
 * whitespace splitting or blind absolute offsets.
 */
const HEADER = ` ${"Profile".padEnd(16)} ${"Model".padEnd(28)} ${"Gateway".padEnd(12)} ${"Alias".padEnd(12)} Distribution`;
const SEPARATOR = ` ${"─".repeat(15)}    ${"─".repeat(27)}    ${"─".repeat(11)}    ${"─".repeat(11)}    ${"─".repeat(20)}`;
const EMPTY_STATE = "No profiles found.";
const CURRENT_MARKER = " ◆";
const NON_CURRENT_MARKER = "  ";
const PROFILE_IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const PROFILE_MIN_WIDTH = 15;
const MODEL_WIDTH = 28;
const MODEL_MAX_DISPLAY = 26;
const GATEWAY_WIDTH = 12;
const ALIAS_MIN_WIDTH = 12;
const DISTRIBUTION_MAX_DISPLAY = 30;
const MAX_ROWS = 1_000;
const MAX_ROW_CODE_POINTS = 512;
const MAX_OUTPUT_CODE_POINTS = 128 * 1_024;

interface ParsedProfileRow {
  readonly profile: ProfileSummary;
  readonly markedCurrent: boolean;
}

function codePoints(value: string): string[] {
  return Array.from(value);
}

function codePointLength(value: string): number {
  return codePoints(value).length;
}

function padMinimum(value: string, width: number): string {
  const padding = Math.max(0, width - codePointLength(value));
  return `${value}${" ".repeat(padding)}`;
}

function isBoundedDisplayValue(value: string, maximum: number): boolean {
  const length = codePointLength(value);
  return (
    length >= 1 &&
    length <= maximum &&
    !/^\s|\s$/u.test(value) &&
    !/[\u0000-\u001F\u007F]/u.test(value)
  );
}

function parseFixedDisplayRegion(
  region: string,
  width: number,
  maximumValueLength: number,
): string | null {
  if (codePointLength(region) !== width) return null;
  const value = region.replace(/ +$/u, "");
  if (!isBoundedDisplayValue(value, maximumValueLength)) return null;
  return padMinimum(value, width) === region ? value : null;
}

function validDistributionDisplay(value: string): boolean {
  if (!isBoundedDisplayValue(value, DISTRIBUTION_MAX_DISPLAY)) return false;
  if (value === "—") return true;
  // Upstream renders `${name}@${version || "?"}` and then truncates to 30.
  // A non-placeholder display shorter than 30 must therefore retain `@`;
  // exactly 30 code points may have truncated the delimiter/version away.
  return value.includes("@") || codePointLength(value) === DISTRIBUTION_MAX_DISPLAY;
}

function validAliasDisplay(value: string, profileName: string): boolean {
  if (!isBoundedDisplayValue(value, MAX_ROW_CODE_POINTS)) return false;
  if (profileName === "default") return value === "—";
  return true;
}

function parseAliasAndDistribution(tail: string, profileName: string): boolean {
  const points = codePoints(tail);
  let matches = 0;

  for (let aliasLength = 1; aliasLength <= points.length; aliasLength += 1) {
    const alias = points.slice(0, aliasLength).join("");
    if (!validAliasDisplay(alias, profileName)) continue;
    const prefix = `${padMinimum(alias, ALIAS_MIN_WIDTH)} `;
    if (!tail.startsWith(prefix)) continue;
    const distribution = tail.slice(prefix.length);
    if (!validDistributionDisplay(distribution)) continue;
    matches += 1;
    if (matches > 1) return false;
  }

  return matches === 1;
}

function parseRow(line: string): ParsedProfileRow | null {
  if (codePointLength(line) > MAX_ROW_CODE_POINTS) return null;

  let markedCurrent: boolean;
  if (line.startsWith(CURRENT_MARKER)) {
    markedCurrent = true;
  } else if (line.startsWith(NON_CURRENT_MARKER)) {
    markedCurrent = false;
  } else {
    return null;
  }

  const afterMarker = line.slice(2);
  const identifier = /^[a-z0-9][a-z0-9_-]{0,63}/.exec(afterMarker)?.[0];
  if (identifier === undefined || !PROFILE_IDENTIFIER.test(identifier)) return null;

  const profilePrefix = `${padMinimum(identifier, PROFILE_MIN_WIDTH)} `;
  if (!afterMarker.startsWith(profilePrefix)) return null;
  let remainder = afterMarker.slice(profilePrefix.length);

  const modelRegion = codePoints(remainder).slice(0, MODEL_WIDTH).join("");
  const model = parseFixedDisplayRegion(modelRegion, MODEL_WIDTH, MODEL_MAX_DISPLAY);
  if (model === null) return null;
  remainder = remainder.slice(modelRegion.length);
  if (!remainder.startsWith(" ")) return null;
  remainder = remainder.slice(1);

  const gatewayRegion = codePoints(remainder).slice(0, GATEWAY_WIDTH).join("");
  const gateway = parseFixedDisplayRegion(gatewayRegion, GATEWAY_WIDTH, GATEWAY_WIDTH);
  if (gateway !== "running" && gateway !== "stopped") return null;
  remainder = remainder.slice(gatewayRegion.length);
  if (!remainder.startsWith(" ")) return null;
  remainder = remainder.slice(1);

  if (!parseAliasAndDistribution(remainder, identifier)) return null;

  return {
    profile: Object.freeze({ name: identifier, current: markedCurrent }),
    markedCurrent,
  };
}

function normalizeLineBoundaries(text: string): string[] | null {
  if (codePointLength(text) > MAX_OUTPUT_CODE_POINTS) return null;
  const normalized = text.replace(/\r\n/g, "\n");
  if (normalized.includes("\r") || /[\u0000-\u0008\u000B-\u001F\u007F]/u.test(normalized)) {
    return null;
  }

  const lines = normalized.split("\n");
  while (lines.length > 0 && /^[ \t]*$/u.test(lines[0] ?? "")) lines.shift();
  while (lines.length > 0 && /^[ \t]*$/u.test(lines.at(-1) ?? "")) lines.pop();
  if (lines.some((line) => line.length === 0)) return null;
  return lines;
}

export function parseProfileListText(text: string): ParserResult<"HERMES_PROFILE_LIST"> {
  const lines = normalizeLineBoundaries(text);
  if (lines === null) return parserFailure("HERMES_PROFILE_LIST", "INVALID_STRUCTURE");

  if (lines.length === 1 && lines[0] === EMPTY_STATE) {
    return parserSuccess("HERMES_PROFILE_LIST", { profiles: Object.freeze([]) }, "EMPTY", 0);
  }

  if (lines.length < 3 || lines[0] !== HEADER || lines[1] !== SEPARATOR) {
    return parserFailure("HERMES_PROFILE_LIST", "PARSER_MISMATCH");
  }

  const rowLines = lines.slice(2);
  if (rowLines.length === 0 || rowLines.length > MAX_ROWS) {
    return parserFailure("HERMES_PROFILE_LIST", "INVALID_STRUCTURE");
  }

  const parsedRows = rowLines.map(parseRow);
  if (parsedRows.some((row) => row === null)) {
    return parserFailure("HERMES_PROFILE_LIST", "PARSER_MISMATCH");
  }

  const rows = parsedRows as ParsedProfileRow[];
  const names = rows.map((row) => row.profile.name);
  if (new Set(names).size !== names.length || rows.filter((row) => row.markedCurrent).length > 1) {
    return parserFailure("HERMES_PROFILE_LIST", "INVALID_STRUCTURE");
  }

  const profiles = Object.freeze(rows.map((row) => row.profile));
  return parserSuccess("HERMES_PROFILE_LIST", { profiles }, "COMPLETE", profiles.length);
}
