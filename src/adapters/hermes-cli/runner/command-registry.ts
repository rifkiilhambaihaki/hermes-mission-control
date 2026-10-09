import type { VerifiedKanbanBoardSlug } from "./verified-board-slug.js";

export const COMMAND_IDS = [
  "HERMES_VERSION",
  "HERMES_PROFILE_LIST",
  "HERMES_STATUS_ALL",
  "HERMES_GATEWAY_LIST",
  "HERMES_GATEWAY_STATUS",
  "HERMES_CRON_STATUS",
  "HERMES_CRON_LIST_DEFAULT",
  "HERMES_SESSIONS_STATS",
  "HERMES_INSIGHTS_1D",
  "HERMES_INSIGHTS_7D",
  "HERMES_INSIGHTS_30D",
  "HERMES_SKILLS_ENABLED",
  "HERMES_TOOLS_LIST",
  "HERMES_MEMORY_STATUS",
  "HERMES_KANBAN_BOARDS",
  "HERMES_KANBAN_BOARD_ITEMS",
] as const;

export type HermesCommandId = (typeof COMMAND_IDS)[number];
export const LIVE_VALIDATED_COMMAND_IDS = Object.freeze([
  "HERMES_PROFILE_LIST",
] as const satisfies readonly HermesCommandId[]);
export const RETIRED_LIVE_MONITORING_COMMAND_IDS = Object.freeze([
  "HERMES_VERSION",
  "HERMES_STATUS_ALL",
  "HERMES_GATEWAY_STATUS",
] as const satisfies readonly HermesCommandId[]);
export const NOT_APPROVED_COMMAND_IDS = Object.freeze([
  "HERMES_GATEWAY_LIST",
] as const satisfies readonly HermesCommandId[]);
export const DEFERRED_NOT_VALIDATED_COMMAND_IDS = Object.freeze([
  "HERMES_CRON_STATUS",
  "HERMES_CRON_LIST_DEFAULT",
  "HERMES_SESSIONS_STATS",
  "HERMES_INSIGHTS_1D",
  "HERMES_INSIGHTS_7D",
  "HERMES_INSIGHTS_30D",
  "HERMES_SKILLS_ENABLED",
  "HERMES_TOOLS_LIST",
  "HERMES_MEMORY_STATUS",
  "HERMES_KANBAN_BOARDS",
  "HERMES_KANBAN_BOARD_ITEMS",
] as const satisfies readonly HermesCommandId[]);
export type RetiredLiveMonitoringCommandId =
  (typeof RETIRED_LIVE_MONITORING_COMMAND_IDS)[number];
export type LiveMonitoringCommandId = (typeof LIVE_VALIDATED_COMMAND_IDS)[number];
export const LIVE_MONITORING_COMMAND_IDS: readonly LiveMonitoringCommandId[] = Object.freeze(
  [...LIVE_VALIDATED_COMMAND_IDS],
);
export type StaticHermesCommandId = Exclude<HermesCommandId, "HERMES_KANBAN_BOARD_ITEMS">;
export type StaticLiveMonitoringCommandId = LiveMonitoringCommandId;
export type TimeoutClass = "T1" | "T2" | "T3";
export type StdoutClass = "SMALL" | "MEDIUM" | "ANALYTICS";
export type CapabilityGovernanceStatus =
  | "LIVE_VALIDATED"
  | "RETIRED_FROM_LIVE_MONITORING"
  | "NOT_APPROVED"
  | "DEFERRED_NOT_VALIDATED";

export const TIMEOUT_MILLISECONDS = Object.freeze({ T1: 3_000, T2: 8_000, T3: 20_000 });
export const STDOUT_LIMIT_BYTES = Object.freeze({
  SMALL: 128 * 1_024,
  MEDIUM: 512 * 1_024,
  ANALYTICS: 1_024 * 1_024,
});
export const STDERR_LIMIT_BYTES = 64 * 1_024;

export interface FrozenCommandDefinition {
  readonly executable: "hermes";
  readonly argv: readonly string[];
  readonly timeoutClass: TimeoutClass;
  readonly stdoutClass: StdoutClass;
  readonly capabilityStatus: CapabilityGovernanceStatus;
}

function definition(
  argv: readonly string[],
  timeoutClass: TimeoutClass,
  stdoutClass: StdoutClass,
  capabilityStatus: CapabilityGovernanceStatus,
): FrozenCommandDefinition {
  return Object.freeze({
    executable: "hermes" as const,
    argv: Object.freeze([...argv]),
    timeoutClass,
    stdoutClass,
    capabilityStatus,
  });
}

export const FROZEN_COMMAND_REGISTRY: Readonly<Record<HermesCommandId, FrozenCommandDefinition>> =
  Object.freeze({
    // Historical compatibility-bootstrap command only. Hermes 0.16.0 may perform
    // update, network, Git, cache, and interrupted-install recovery work here.
    HERMES_VERSION: definition(
      ["--version"],
      "T1",
      "SMALL",
      "RETIRED_FROM_LIVE_MONITORING",
    ),
    HERMES_PROFILE_LIST: definition(["profile", "list"], "T1", "SMALL", "LIVE_VALIDATED"),
    // Historical candidate only. `status --all` can emit raw secrets and
    // can trigger network, credential refresh/write, and startup recovery paths.
    HERMES_STATUS_ALL: definition(
      ["status", "--all"],
      "T1",
      "SMALL",
      "RETIRED_FROM_LIVE_MONITORING",
    ),
    HERMES_GATEWAY_LIST: definition(["gateway", "list"], "T1", "SMALL", "NOT_APPROVED"),
    HERMES_GATEWAY_STATUS: definition(
      ["gateway", "status"],
      "T1",
      "SMALL",
      "RETIRED_FROM_LIVE_MONITORING",
    ),
    HERMES_CRON_STATUS: definition(["cron", "status"], "T1", "SMALL", "DEFERRED_NOT_VALIDATED"),
    HERMES_CRON_LIST_DEFAULT: definition(["cron", "list"], "T2", "MEDIUM", "DEFERRED_NOT_VALIDATED"),
    HERMES_SESSIONS_STATS: definition(["sessions", "stats"], "T1", "SMALL", "DEFERRED_NOT_VALIDATED"),
    HERMES_INSIGHTS_1D: definition(["insights", "--days", "1"], "T3", "ANALYTICS", "DEFERRED_NOT_VALIDATED"),
    HERMES_INSIGHTS_7D: definition(["insights", "--days", "7"], "T3", "ANALYTICS", "DEFERRED_NOT_VALIDATED"),
    HERMES_INSIGHTS_30D: definition(["insights", "--days", "30"], "T3", "ANALYTICS", "DEFERRED_NOT_VALIDATED"),
    HERMES_SKILLS_ENABLED: definition(["skills", "list"], "T2", "MEDIUM", "DEFERRED_NOT_VALIDATED"),
    HERMES_TOOLS_LIST: definition(["tools", "list"], "T2", "MEDIUM", "DEFERRED_NOT_VALIDATED"),
    HERMES_MEMORY_STATUS: definition(["memory", "status"], "T1", "SMALL", "DEFERRED_NOT_VALIDATED"),
    HERMES_KANBAN_BOARDS: definition(["kanban", "boards", "list"], "T2", "MEDIUM", "DEFERRED_NOT_VALIDATED"),
    HERMES_KANBAN_BOARD_ITEMS: definition([], "T2", "MEDIUM", "DEFERRED_NOT_VALIDATED"),
  });

export function resolveFrozenCommand(
  commandId: HermesCommandId,
  boardSlug?: VerifiedKanbanBoardSlug,
): FrozenCommandDefinition {
  const command = FROZEN_COMMAND_REGISTRY[commandId];
  if (commandId !== "HERMES_KANBAN_BOARD_ITEMS") return command;
  if (boardSlug === undefined) {
    throw new Error("A verified Kanban board slug is required for board items.");
  }
  return definition(
    ["kanban", "--board", String(boardSlug), "list"],
    "T2",
    "MEDIUM",
    "DEFERRED_NOT_VALIDATED",
  );
}
