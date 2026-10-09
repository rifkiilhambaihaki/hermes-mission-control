import type { CronJobSummary, ParserResult } from "./contracts.js";
import {
  optionalIsoTimestamp,
  parsePipeTable,
  strictNonnegativeInteger,
} from "./parser-helpers.js";
import { parserFailure, parserSuccess } from "./result-builders.js";
import { controlledEnum, sanitizeSafeText, sanitizeTokenFreeCategory } from "./sanitization.js";

function safeSchedule(type: CronJobSummary["scheduleType"], value: string): string {
  const schedule = sanitizeSafeText(value, { maxLength: 64 });
  if (type === "CRON" && !/^[0-9*/?,\-]+(?: [0-9*/?,\-]+){4}$/.test(schedule)) {
    throw new Error("Invalid cron expression.");
  }
  if (type === "INTERVAL" && !/^every [1-9]\d* ?[mhd]$/.test(schedule)) {
    throw new Error("Invalid interval expression.");
  }
  if (type === "ONCE" && optionalIsoTimestamp(schedule) === null) {
    throw new Error("Invalid one-shot timestamp.");
  }
  return schedule;
}

function deliveryClass(value: string): CronJobSummary["deliveryClass"] {
  const normalized = value.trim().toLowerCase();
  if (normalized === "origin") return "ORIGIN";
  if (normalized === "local") return "LOCAL";
  if (normalized === "none") return "NONE";
  if (normalized === "telegram" || normalized.startsWith("telegram:")) return "TELEGRAM";
  return "OTHER";
}

export function parseCronListText(text: string): ParserResult<"HERMES_CRON_LIST_DEFAULT"> {
  const table = parsePipeTable(
    text,
    "Cron Jobs",
    [
      "NAME",
      "SCHEDULE_TYPE",
      "SCHEDULE",
      "STATE",
      "RECURRENCE",
      "NEXT_RUN",
      "LAST_RUN",
      "LAST_STATUS",
      "DURATION_MS",
      "MODE",
      "DELIVERY",
    ],
    [],
    ["PROMPT", "DESTINATION", "SCRIPT_PATH", "WORKDIR", "ENVIRONMENT", "CONTEXT"],
  );
  if (!table.ok) return parserFailure("HERMES_CRON_LIST_DEFAULT", table.errorCode);
  try {
    const jobs: CronJobSummary[] = table.rows.map((row) => {
      const name = sanitizeTokenFreeCategory(row.NAME ?? "");
      const scheduleType = controlledEnum(row.SCHEDULE_TYPE ?? "", {
        cron: "CRON",
        interval: "INTERVAL",
        once: "ONCE",
      });
      return {
        jobRef: `cron-${name}`,
        name,
        scheduleType,
        schedule: safeSchedule(scheduleType, row.SCHEDULE ?? ""),
        state: controlledEnum(row.STATE ?? "", { active: "ACTIVE", paused: "PAUSED" }),
        recurrence: controlledEnum(row.RECURRENCE ?? "", {
          recurring: "RECURRING",
          "one-shot": "ONE_SHOT",
        }),
        nextRun: optionalIsoTimestamp(row.NEXT_RUN ?? ""),
        lastRun: optionalIsoTimestamp(row.LAST_RUN ?? ""),
        lastStatus: controlledEnum(row.LAST_STATUS ?? "", {
          success: "SUCCESS",
          failed: "FAILED",
          running: "RUNNING",
          unknown: "UNKNOWN",
        }),
        durationMs: row.DURATION_MS === "-" ? null : strictNonnegativeInteger(row.DURATION_MS ?? ""),
        executionMode: controlledEnum(row.MODE ?? "", {
          agent: "AGENT",
          "no-agent": "NO_AGENT",
        }),
        deliveryClass: deliveryClass(row.DELIVERY ?? ""),
      };
    });
    if (new Set(jobs.map((job) => job.name)).size !== jobs.length) throw new Error("duplicate");
    const warnings = [...table.warnings];
    if (
      jobs.some(
        (job) =>
          job.nextRun === null ||
          job.lastRun === null ||
          job.durationMs === null ||
          job.lastStatus === "UNKNOWN",
      ) &&
      !warnings.includes("OPTIONAL_FIELD_MISSING")
    ) {
      warnings.push("OPTIONAL_FIELD_MISSING");
    }
    return parserSuccess(
      "HERMES_CRON_LIST_DEFAULT",
      { jobs: Object.freeze(jobs) },
      jobs.length === 0 ? "EMPTY" : warnings.length > 0 ? "PARTIAL" : "COMPLETE",
      jobs.length,
      warnings,
    );
  } catch {
    return parserFailure("HERMES_CRON_LIST_DEFAULT", "INVALID_STRUCTURE");
  }
}
