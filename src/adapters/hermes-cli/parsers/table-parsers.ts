import type {
  GatewayListEntry,
  SkillSummary,
  ToolSummary,
  ParserResult,
} from "./contracts.js";
import { parsePipeTable } from "./parser-helpers.js";
import { parserFailure, parserSuccess } from "./result-builders.js";
import { controlledEnum, sanitizeSafeText, sanitizeTokenFreeCategory } from "./sanitization.js";

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export function parseGatewayListText(text: string): ParserResult<"HERMES_GATEWAY_LIST"> {
  const table = parsePipeTable(text, "Gateways", ["NAME", "STATE", "MODE"]);
  if (!table.ok) return parserFailure("HERMES_GATEWAY_LIST", table.errorCode);
  try {
    const gateways: GatewayListEntry[] = table.rows.map((row) => ({
      name: sanitizeTokenFreeCategory(row.NAME ?? ""),
      state: controlledEnum(row.STATE ?? "", {
        running: "RUNNING",
        stopped: "STOPPED",
        unknown: "UNKNOWN",
      }),
      mode: controlledEnum(row.MODE ?? "", {
        managed: "MANAGED",
        manual: "MANUAL",
        unknown: "UNKNOWN",
      }),
    }));
    if (hasDuplicate(gateways.map((gateway) => gateway.name))) throw new Error("duplicate");
    return parserSuccess(
      "HERMES_GATEWAY_LIST",
      { gateways },
      gateways.length === 0 ? "EMPTY" : "COMPLETE",
      gateways.length,
      table.warnings,
    );
  } catch {
    return parserFailure("HERMES_GATEWAY_LIST", "INVALID_STRUCTURE");
  }
}

export function parseSkillsText(text: string): ParserResult<"HERMES_SKILLS_ENABLED"> {
  const table = parsePipeTable(
    text,
    "Enabled Skills",
    ["NAME"],
    ["CATEGORY", "SOURCE"],
    ["PATH"],
  );
  if (!table.ok) return parserFailure("HERMES_SKILLS_ENABLED", table.errorCode);
  try {
    const skills: SkillSummary[] = table.rows.map((row) => ({
      name: sanitizeTokenFreeCategory(row.NAME ?? ""),
      category: row.CATEGORY === undefined || row.CATEGORY === "-" ? null : sanitizeTokenFreeCategory(row.CATEGORY),
      sourceCategory: row.SOURCE === undefined || row.SOURCE === "-" ? null : sanitizeTokenFreeCategory(row.SOURCE),
    }));
    if (hasDuplicate(skills.map((skill) => skill.name))) throw new Error("duplicate");
    const warnings = [...table.warnings];
    if (
      skills.some((skill) => skill.category === null || skill.sourceCategory === null) &&
      !warnings.includes("OPTIONAL_FIELD_MISSING")
    ) {
      warnings.push("OPTIONAL_FIELD_MISSING");
    }
    return parserSuccess(
      "HERMES_SKILLS_ENABLED",
      { enabledCount: skills.length, skills: Object.freeze(skills) },
      skills.length === 0 ? "EMPTY" : warnings.length > 0 ? "PARTIAL" : "COMPLETE",
      skills.length,
      warnings,
    );
  } catch {
    return parserFailure("HERMES_SKILLS_ENABLED", "INVALID_STRUCTURE");
  }
}

export function parseToolsText(text: string): ParserResult<"HERMES_TOOLS_LIST"> {
  const table = parsePipeTable(
    text,
    "Tools",
    ["NAME", "CATEGORY", "STATUS"],
    [],
    ["CREDENTIAL_REQUIREMENTS", "PROVIDER_DETAILS"],
  );
  if (!table.ok) return parserFailure("HERMES_TOOLS_LIST", table.errorCode);
  try {
    const tools: ToolSummary[] = table.rows.map((row) => ({
      name: sanitizeTokenFreeCategory(row.NAME ?? ""),
      category: sanitizeTokenFreeCategory(row.CATEGORY ?? ""),
      status: controlledEnum(row.STATUS ?? "", {
        enabled: "ENABLED",
        disabled: "DISABLED",
        unavailable: "UNAVAILABLE",
        unknown: "UNKNOWN",
      }),
    }));
    if (hasDuplicate(tools.map((tool) => tool.name))) throw new Error("duplicate");
    return parserSuccess(
      "HERMES_TOOLS_LIST",
      { tools },
      tools.length === 0 ? "EMPTY" : "COMPLETE",
      tools.length,
      table.warnings,
    );
  } catch {
    return parserFailure("HERMES_TOOLS_LIST", "INVALID_STRUCTURE");
  }
}
