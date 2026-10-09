import type { InsightsData, ParserResult } from "./contracts.js";
import { parseKeyValueSection, strictNonnegativeInteger } from "./parser-helpers.js";
import { parserFailure, parserSuccess } from "./result-builders.js";
import { controlledEnum, sanitizeTokenFreeCategory } from "./sanitization.js";

export function parseCronStatusText(text: string): ParserResult<"HERMES_CRON_STATUS"> {
  const section = parseKeyValueSection(text, "Cron Status", ["Scheduler", "Active Jobs", "Paused Jobs"]);
  if (!section.ok) return parserFailure("HERMES_CRON_STATUS", section.errorCode);
  try {
    const data = {
      schedulerState: controlledEnum(section.values.Scheduler ?? "", {
        running: "RUNNING",
        stopped: "STOPPED",
        unavailable: "UNAVAILABLE",
        unknown: "UNKNOWN",
      }),
      activeJobs: strictNonnegativeInteger(section.values["Active Jobs"] ?? ""),
      pausedJobs: strictNonnegativeInteger(section.values["Paused Jobs"] ?? ""),
    } as const;
    return parserSuccess("HERMES_CRON_STATUS", data, "COMPLETE", 1);
  } catch {
    return parserFailure("HERMES_CRON_STATUS", "INVALID_STRUCTURE");
  }
}

export function parseSessionsStatsText(text: string): ParserResult<"HERMES_SESSIONS_STATS"> {
  const section = parseKeyValueSection(
    text,
    "Session Stats",
    ["Total Sessions", "Total Messages"],
    ["Active Profiles", "Archived Sessions"],
    ["Database Path", "Latest Session ID", "Latest Title", "Latest Message"],
  );
  if (!section.ok) return parserFailure("HERMES_SESSIONS_STATS", section.errorCode);
  try {
    const safeAggregates: Record<string, number> = {};
    if (section.values["Active Profiles"] !== undefined) {
      safeAggregates.activeProfiles = strictNonnegativeInteger(section.values["Active Profiles"]);
    }
    if (section.values["Archived Sessions"] !== undefined) {
      safeAggregates.archivedSessions = strictNonnegativeInteger(section.values["Archived Sessions"]);
    }
    const data = {
      totalSessions: strictNonnegativeInteger(section.values["Total Sessions"] ?? ""),
      totalMessages: strictNonnegativeInteger(section.values["Total Messages"] ?? ""),
      safeAggregates: Object.freeze(safeAggregates),
    };
    const aggregateValues = Object.values(data.safeAggregates);
    if (
      data.totalSessions === 0 &&
      (data.totalMessages !== 0 || aggregateValues.some((value) => value > 0))
    ) {
      throw new Error("contradictory empty aggregate");
    }
    const completeness =
      data.totalSessions === 0 &&
      data.totalMessages === 0 &&
      aggregateValues.every((value) => value === 0)
        ? "EMPTY"
        : section.warnings.length > 0
          ? "PARTIAL"
          : "COMPLETE";
    return parserSuccess(
      "HERMES_SESSIONS_STATS",
      data,
      completeness,
      completeness === "EMPTY" ? 0 : 1,
      section.warnings,
    );
  } catch {
    return parserFailure("HERMES_SESSIONS_STATS", "INVALID_STRUCTURE");
  }
}

const INSIGHT_IDS = {
  "1d": "HERMES_INSIGHTS_1D",
  "7d": "HERMES_INSIGHTS_7D",
  "30d": "HERMES_INSIGHTS_30D",
} as const;

type InsightCommandId = (typeof INSIGHT_IDS)[keyof typeof INSIGHT_IDS];

export function parseInsightsText<W extends keyof typeof INSIGHT_IDS>(
  text: string,
  expectedWindow: W,
): ParserResult<(typeof INSIGHT_IDS)[W]> {
  const commandId = INSIGHT_IDS[expectedWindow];
  const section = parseKeyValueSection(
    text,
    "Insights",
    [
      "Window",
      "Sessions",
      "Messages",
      "Tool Calls",
      "Input Tokens",
      "Output Tokens",
      "Reported Total Tokens",
    ],
    ["Cached Tokens", "Other Tokens", "Model Category", "Provider Category", "Source Category"],
  );
  if (!section.ok) return parserFailure(commandId, section.errorCode);
  try {
    if (section.values.Window !== expectedWindow) throw new Error("window mismatch");
    const optionalNumber = (key: string) =>
      section.values[key] === undefined ? null : strictNonnegativeInteger(section.values[key]);
    const optionalCategory = (key: string) =>
      section.values[key] === undefined ? null : sanitizeTokenFreeCategory(section.values[key]);
    const data: InsightsData = {
      window: expectedWindow,
      sessions: strictNonnegativeInteger(section.values.Sessions ?? ""),
      messages: strictNonnegativeInteger(section.values.Messages ?? ""),
      toolCalls: strictNonnegativeInteger(section.values["Tool Calls"] ?? ""),
      inputTokens: strictNonnegativeInteger(section.values["Input Tokens"] ?? ""),
      outputTokens: strictNonnegativeInteger(section.values["Output Tokens"] ?? ""),
      reportedTotalTokens: strictNonnegativeInteger(section.values["Reported Total Tokens"] ?? ""),
      cachedTokens: optionalNumber("Cached Tokens"),
      otherTokens: optionalNumber("Other Tokens"),
      modelCategory: optionalCategory("Model Category"),
      providerCategory: optionalCategory("Provider Category"),
      sourceCategory: optionalCategory("Source Category"),
    };
    const requiredMetrics = [
      data.sessions,
      data.messages,
      data.toolCalls,
      data.inputTokens,
      data.outputTokens,
      data.reportedTotalTokens,
    ];
    const allMetrics = [
      ...requiredMetrics,
      data.cachedTokens ?? 0,
      data.otherTokens ?? 0,
    ];
    const completeness = allMetrics.every((metric) => metric === 0)
      ? "EMPTY"
      : section.warnings.length > 0
        ? "PARTIAL"
        : "COMPLETE";
    return parserSuccess(
      commandId,
      data as never,
      completeness,
      completeness === "EMPTY" ? 0 : 1,
      section.warnings,
    ) as ParserResult<(typeof INSIGHT_IDS)[W]>;
  } catch {
    return parserFailure(commandId, "INVALID_STRUCTURE");
  }
}

export function parseMemoryStatusText(text: string): ParserResult<"HERMES_MEMORY_STATUS"> {
  const section = parseKeyValueSection(
    text,
    "Memory Status",
    ["Built-in", "External Provider"],
    ["Provider Category"],
    ["Memory Records", "MEMORY", "SOUL", "USER", "Provider Credential", "Database Path"],
  );
  if (!section.ok) return parserFailure("HERMES_MEMORY_STATUS", section.errorCode);
  try {
    const data = {
      builtInState: controlledEnum(section.values["Built-in"] ?? "", {
        enabled: "ENABLED",
        disabled: "DISABLED",
        unknown: "UNKNOWN",
      }),
      externalProviderState: controlledEnum(section.values["External Provider"] ?? "", {
        enabled: "ENABLED",
        disabled: "DISABLED",
        unavailable: "UNAVAILABLE",
        unknown: "UNKNOWN",
      }),
      providerCategory:
        section.values["Provider Category"] === undefined
          ? null
          : sanitizeTokenFreeCategory(section.values["Provider Category"]),
    } as const;
    return parserSuccess(
      "HERMES_MEMORY_STATUS",
      data,
      section.warnings.length > 0 ? "PARTIAL" : "COMPLETE",
      1,
      section.warnings,
    );
  } catch {
    return parserFailure("HERMES_MEMORY_STATUS", "INVALID_STRUCTURE");
  }
}
