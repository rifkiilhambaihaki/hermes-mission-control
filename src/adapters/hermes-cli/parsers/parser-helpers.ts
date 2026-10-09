import type { ParserFailureCode, ParserWarning } from "./contracts.js";
import { boundedArray, normalizeCliText, sanitizeSafeText } from "./sanitization.js";

interface PreparedSection {
  readonly ok: true;
  readonly body: readonly string[];
}
interface InvalidSection {
  readonly ok: false;
  readonly errorCode: ParserFailureCode;
}
export type SectionResult = PreparedSection | InvalidSection;

function normalizedStructuralLine(line: string): string {
  return line.trim().replace(/[ \t]+/g, " ");
}

export function prepareSection(text: string, expectedTitle: string): SectionResult {
  let normalized: string;
  try {
    normalized = normalizeCliText(text);
  } catch {
    return { ok: false, errorCode: "INVALID_STRUCTURE" };
  }
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.some((line) => /^\[(?:output )?truncated\]$/i.test(line))) {
    return { ok: false, errorCode: "TRUNCATED_OUTPUT" };
  }
  if (normalizedStructuralLine(lines[0] ?? "") !== expectedTitle) {
    return { ok: false, errorCode: "PARSER_MISMATCH" };
  }
  if (lines.at(-1) !== "End") return { ok: false, errorCode: "TRUNCATED_OUTPUT" };
  return { ok: true, body: lines.slice(1, -1) };
}

export interface ParsedTable {
  readonly ok: true;
  readonly empty: boolean;
  readonly rows: readonly Readonly<Record<string, string>>[];
  readonly warnings: readonly ParserWarning[];
}
export type TableResult = ParsedTable | InvalidSection;

function splitCells(line: string): string[] {
  return line.split("|").map((cell) => cell.trim());
}

export function parsePipeTable(
  text: string,
  expectedTitle: string,
  requiredHeaders: readonly string[],
  optionalHeaders: readonly string[] = [],
  ignoredHeaders: readonly string[] = [],
): TableResult {
  const section = prepareSection(text, expectedTitle);
  if (!section.ok) return section;
  if (section.body.length === 1 && section.body[0] === "None") {
    return { ok: true, empty: true, rows: [], warnings: [] };
  }
  if (section.body.length < 2) return { ok: false, errorCode: "PARSER_MISMATCH" };
  const headers = splitCells(section.body[0] ?? "");
  if (
    headers.some((header) => !/^[A-Z][A-Z0-9_]*$/.test(header)) ||
    new Set(headers).size !== headers.length ||
    requiredHeaders.some((header) => !headers.includes(header))
  ) {
    return { ok: false, errorCode: "PARSER_MISMATCH" };
  }
  const approvedHeaders = new Set([...requiredHeaders, ...optionalHeaders, ...ignoredHeaders]);
  const warnings: ParserWarning[] = [];
  if (headers.some((header) => !approvedHeaders.has(header))) {
    warnings.push("ADDITIONAL_COLUMN_IGNORED");
  }
  if (optionalHeaders.some((header) => !headers.includes(header))) {
    warnings.push("OPTIONAL_FIELD_MISSING");
  }
  const rows: Readonly<Record<string, string>>[] = [];
  for (const line of section.body.slice(1)) {
    const cells = splitCells(line);
    if (
      cells.length !== headers.length ||
      cells.some((cell) => cell.length === 0 || cell.length > 4_096)
    ) {
      return { ok: false, errorCode: "PARSER_MISMATCH" };
    }
    rows.push(Object.freeze(Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))));
  }
  try {
    return { ok: true, empty: rows.length === 0, rows: boundedArray(rows, 1_000), warnings };
  } catch {
    return { ok: false, errorCode: "INVALID_STRUCTURE" };
  }
}

export interface ParsedKeyValues {
  readonly ok: true;
  readonly values: Readonly<Record<string, string>>;
  readonly warnings: readonly ParserWarning[];
}
export type KeyValueResult = ParsedKeyValues | InvalidSection;

export function parseKeyValueSection(
  text: string,
  expectedTitle: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
  ignoredKeys: readonly string[] = [],
): KeyValueResult {
  const section = prepareSection(text, expectedTitle);
  if (!section.ok) return section;
  const approved = new Set([...requiredKeys, ...optionalKeys, ...ignoredKeys]);
  const values: Record<string, string> = {};
  const seenKeys = new Set<string>();
  const warnings: ParserWarning[] = [];
  for (const line of section.body) {
    const separator = line.indexOf(":");
    if (separator <= 0) return { ok: false, errorCode: "PARSER_MISMATCH" };
    const key = normalizedStructuralLine(line.slice(0, separator));
    const value = line.slice(separator + 1).trim();
    if (
      !/^[A-Za-z][A-Za-z -]*$/.test(key) ||
      value.length === 0 ||
      value.length > 4_096 ||
      seenKeys.has(key)
    ) {
      return { ok: false, errorCode: "PARSER_MISMATCH" };
    }
    seenKeys.add(key);
    if (!approved.has(key)) return { ok: false, errorCode: "PARSER_MISMATCH" };
    if (ignoredKeys.includes(key)) continue;
    values[key] = value;
  }
  if (requiredKeys.some((key) => values[key] === undefined)) {
    return { ok: false, errorCode: "PARSER_MISMATCH" };
  }
  if (optionalKeys.some((key) => values[key] === undefined)) warnings.push("OPTIONAL_FIELD_MISSING");
  return { ok: true, values: Object.freeze(values), warnings };
}

export function strictNonnegativeInteger(value: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new Error("Expected a locale-independent integer.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("Integer is outside the safe range.");
  return parsed;
}

export function optionalIsoTimestamp(value: string): string | null {
  if (value === "-") return null;
  const safe = sanitizeSafeText(value, { maxLength: 32 });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(safe) || !Number.isFinite(Date.parse(safe))) {
    throw new Error("Timestamp is outside the frozen ISO form.");
  }
  return safe;
}
