import type { SanitizedRunnerErrorCode } from "../runner/bounded-process-executor.js";
import type { GatewayObservationData } from "../../../domain/gateway/gateway-observation.js";
import {
  LIVE_MONITORING_COMMAND_IDS,
  type HermesCommandId,
  type LiveMonitoringCommandId,
} from "../runner/command-registry.js";
import type { ValidatedKanbanBoardsResult, VerifiedKanbanBoardSlug } from "../runner/verified-board-slug.js";

export const PARSER_VERSION = "1.0.0" as const;

export type ParserCompleteness = "COMPLETE" | "PARTIAL" | "EMPTY";
export type ParserSourceFormat = "HUMAN_TEXT" | "JSON";
export type ParserWarning =
  | "ADDITIONAL_COLUMN_IGNORED"
  | "OPTIONAL_FIELD_MISSING"
  | "SOURCE_STDERR_DISCARDED";
export type ParserFailureCode =
  | "COMMAND_RETIRED"
  | "COMMAND_NOT_LIVE_VALIDATED"
  | "PARSER_MISMATCH"
  | "TRUNCATED_OUTPUT"
  | "UNSUPPORTED_VERSION"
  | "INVALID_JSON"
  | "INVALID_STRUCTURE"
  | "RUNNER_UNAVAILABLE";

export interface SanitizedParserMetadata {
  readonly sourceFormat: ParserSourceFormat;
  readonly recordCount: number;
}

export interface VersionData {
  readonly version: "0.16.0";
}
export interface ProfileSummary {
  readonly name: string;
  readonly current: boolean;
}
export interface ProfileListData {
  readonly profiles: readonly ProfileSummary[];
}
export type ParserCommandId = LiveMonitoringCommandId;
export const PARSER_COMMAND_IDS: readonly ParserCommandId[] = Object.freeze(
  [...LIVE_MONITORING_COMMAND_IDS],
);
export interface GatewayListEntry {
  readonly name: string;
  readonly state: "RUNNING" | "STOPPED" | "UNKNOWN";
  readonly mode: "MANAGED" | "MANUAL" | "UNKNOWN";
}
export interface GatewayListData {
  readonly gateways: readonly GatewayListEntry[];
}
export interface GatewayStatusData extends GatewayObservationData {
  readonly telegramConnectivity: "CONNECTED" | "DISCONNECTED" | "UNKNOWN";
}
export interface CronStatusData {
  readonly schedulerState: "RUNNING" | "STOPPED" | "UNAVAILABLE" | "UNKNOWN";
  readonly activeJobs: number;
  readonly pausedJobs: number;
}
export interface CronJobSummary {
  readonly jobRef: string;
  readonly name: string;
  readonly scheduleType: "CRON" | "INTERVAL" | "ONCE";
  readonly schedule: string;
  readonly state: "ACTIVE" | "PAUSED";
  readonly recurrence: "RECURRING" | "ONE_SHOT";
  readonly nextRun: string | null;
  readonly lastRun: string | null;
  readonly lastStatus: "SUCCESS" | "FAILED" | "RUNNING" | "UNKNOWN";
  readonly durationMs: number | null;
  readonly executionMode: "AGENT" | "NO_AGENT";
  readonly deliveryClass: "ORIGIN" | "LOCAL" | "TELEGRAM" | "OTHER" | "NONE";
}
export interface CronListData {
  readonly jobs: readonly CronJobSummary[];
}
export interface SessionsStatsData {
  readonly totalSessions: number;
  readonly totalMessages: number;
  readonly safeAggregates: Readonly<Record<string, number>>;
}
export interface InsightsData {
  readonly window: "1d" | "7d" | "30d";
  readonly sessions: number;
  readonly messages: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reportedTotalTokens: number;
  readonly cachedTokens: number | null;
  readonly otherTokens: number | null;
  readonly modelCategory: string | null;
  readonly providerCategory: string | null;
  readonly sourceCategory: string | null;
}
export interface SkillSummary {
  readonly name: string;
  readonly category: string | null;
  readonly sourceCategory: string | null;
}
export interface SkillsData {
  readonly enabledCount: number;
  readonly skills: readonly SkillSummary[];
}
export interface ToolSummary {
  readonly name: string;
  readonly category: string;
  readonly status: "ENABLED" | "DISABLED" | "UNAVAILABLE" | "UNKNOWN";
}
export interface ToolsData {
  readonly tools: readonly ToolSummary[];
}
export interface MemoryStatusData {
  readonly builtInState: "ENABLED" | "DISABLED" | "UNKNOWN";
  readonly externalProviderState: "ENABLED" | "DISABLED" | "UNAVAILABLE" | "UNKNOWN";
  readonly providerCategory: string | null;
}
export interface KanbanBoardSummary {
  readonly slug: string;
  readonly name: string;
}
export interface KanbanBoardsData {
  readonly boards: readonly KanbanBoardSummary[];
  readonly validatedBoards: ValidatedKanbanBoardsResult;
}
export interface KanbanBoardItemsData {
  readonly boardSlug: VerifiedKanbanBoardSlug;
  readonly totalCount: number;
  readonly counts: Readonly<Record<"TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED", number>>;
}

export interface HermesNormalizedDataByCommand {
  readonly HERMES_VERSION: VersionData;
  readonly HERMES_PROFILE_LIST: ProfileListData;
  readonly HERMES_STATUS_ALL: never;
  readonly HERMES_GATEWAY_LIST: GatewayListData;
  readonly HERMES_GATEWAY_STATUS: GatewayStatusData;
  readonly HERMES_CRON_STATUS: CronStatusData;
  readonly HERMES_CRON_LIST_DEFAULT: CronListData;
  readonly HERMES_SESSIONS_STATS: SessionsStatsData;
  readonly HERMES_INSIGHTS_1D: InsightsData;
  readonly HERMES_INSIGHTS_7D: InsightsData;
  readonly HERMES_INSIGHTS_30D: InsightsData;
  readonly HERMES_SKILLS_ENABLED: SkillsData;
  readonly HERMES_TOOLS_LIST: ToolsData;
  readonly HERMES_MEMORY_STATUS: MemoryStatusData;
  readonly HERMES_KANBAN_BOARDS: KanbanBoardsData;
  readonly HERMES_KANBAN_BOARD_ITEMS: KanbanBoardItemsData;
}

export interface ParserSuccess<K extends HermesCommandId> {
  readonly ok: true;
  readonly commandId: K;
  readonly normalizedData: HermesNormalizedDataByCommand[K];
  readonly completeness: ParserCompleteness;
  readonly warnings: readonly ParserWarning[];
  readonly sanitizedMetadata: SanitizedParserMetadata;
  readonly parserVersion: typeof PARSER_VERSION;
}
export interface ParserFailure<K extends HermesCommandId> {
  readonly ok: false;
  readonly commandId: K;
  readonly errorCode: ParserFailureCode;
  readonly runnerErrorCode?: SanitizedRunnerErrorCode;
  readonly sanitizedMetadata: SanitizedParserMetadata;
  readonly parserVersion: typeof PARSER_VERSION;
}
export type ParserResult<K extends HermesCommandId> = K extends HermesCommandId
  ? ParserSuccess<K> | ParserFailure<K>
  : never;
export type AnyParserResult = {
  readonly [K in HermesCommandId]: ParserResult<K>;
}[HermesCommandId];
