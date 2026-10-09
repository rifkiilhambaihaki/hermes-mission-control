import { describe, expect, expectTypeOf, it } from "vitest";

import {
  COMMAND_IDS,
  DEFERRED_NOT_VALIDATED_COMMAND_IDS,
  FROZEN_COMMAND_REGISTRY,
  LIVE_MONITORING_COMMAND_IDS,
  LIVE_VALIDATED_COMMAND_IDS,
  NOT_APPROVED_COMMAND_IDS,
  RETIRED_LIVE_MONITORING_COMMAND_IDS,
  resolveFrozenCommand,
  type LiveMonitoringCommandId,
} from "../../../src/adapters/hermes-cli/runner/command-registry.js";
import {
  selectVerifiedBoardSlug,
  type ValidatedKanbanBoardsResult,
} from "../../../src/adapters/hermes-cli/runner/verified-board-slug.js";

function validatedBoards(...boardSlugs: string[]): ValidatedKanbanBoardsResult {
  return {
    sourceCommandId: "HERMES_KANBAN_BOARDS",
    boardSlugs,
  } as unknown as ValidatedKanbanBoardsResult;
}

describe("frozen Hermes command registry", () => {
  it("retains the complete historical candidate registry and only the historical executable", () => {
    expect(Object.keys(FROZEN_COMMAND_REGISTRY)).toEqual(COMMAND_IDS);
    for (const id of COMMAND_IDS) {
      const command = FROZEN_COMMAND_REGISTRY[id];
      expect(command.executable).toBe("hermes");
      expect(command.argv.every((argument) => argument.length > 0)).toBe(true);
      expect(command.executable).not.toBe("hermes-agent");
      expect(Object.isFrozen(command.argv)).toBe(true);
    }
  });

  it("freezes the approved capability matrix", () => {
    expect(LIVE_VALIDATED_COMMAND_IDS).toEqual(["HERMES_PROFILE_LIST"]);
    expect(LIVE_MONITORING_COMMAND_IDS).toEqual(["HERMES_PROFILE_LIST"]);
    expect(RETIRED_LIVE_MONITORING_COMMAND_IDS).toEqual([
      "HERMES_VERSION",
      "HERMES_STATUS_ALL",
      "HERMES_GATEWAY_STATUS",
    ]);
    expect(NOT_APPROVED_COMMAND_IDS).toEqual(["HERMES_GATEWAY_LIST"]);
    expect(DEFERRED_NOT_VALIDATED_COMMAND_IDS).toEqual([
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
    ]);
    expect(
      Object.fromEntries(
        COMMAND_IDS.map((commandId) => [
          commandId,
          FROZEN_COMMAND_REGISTRY[commandId].capabilityStatus,
        ]),
      ),
    ).toEqual({
      HERMES_VERSION: "RETIRED_FROM_LIVE_MONITORING",
      HERMES_PROFILE_LIST: "LIVE_VALIDATED",
      HERMES_STATUS_ALL: "RETIRED_FROM_LIVE_MONITORING",
      HERMES_GATEWAY_LIST: "NOT_APPROVED",
      HERMES_GATEWAY_STATUS: "RETIRED_FROM_LIVE_MONITORING",
      HERMES_CRON_STATUS: "DEFERRED_NOT_VALIDATED",
      HERMES_CRON_LIST_DEFAULT: "DEFERRED_NOT_VALIDATED",
      HERMES_SESSIONS_STATS: "DEFERRED_NOT_VALIDATED",
      HERMES_INSIGHTS_1D: "DEFERRED_NOT_VALIDATED",
      HERMES_INSIGHTS_7D: "DEFERRED_NOT_VALIDATED",
      HERMES_INSIGHTS_30D: "DEFERRED_NOT_VALIDATED",
      HERMES_SKILLS_ENABLED: "DEFERRED_NOT_VALIDATED",
      HERMES_TOOLS_LIST: "DEFERRED_NOT_VALIDATED",
      HERMES_MEMORY_STATUS: "DEFERRED_NOT_VALIDATED",
      HERMES_KANBAN_BOARDS: "DEFERRED_NOT_VALIDATED",
      HERMES_KANBAN_BOARD_ITEMS: "DEFERRED_NOT_VALIDATED",
    });
    expectTypeOf<"HERMES_STATUS_ALL">().not.toMatchTypeOf<LiveMonitoringCommandId>();
    expectTypeOf<"HERMES_GATEWAY_STATUS">().not.toMatchTypeOf<LiveMonitoringCommandId>();
    expectTypeOf<"HERMES_GATEWAY_LIST">().not.toMatchTypeOf<LiveMonitoringCommandId>();
    expectTypeOf<"HERMES_CRON_STATUS">().not.toMatchTypeOf<LiveMonitoringCommandId>();
    expectTypeOf<"HERMES_PROFILE_LIST">().toMatchTypeOf<LiveMonitoringCommandId>();
  });

  it("keeps status-all as the only historical status mapping and introduces no fallback", () => {
    expect(
      COMMAND_IDS.filter((commandId) => FROZEN_COMMAND_REGISTRY[commandId].argv[0] === "status"),
    ).toEqual(["HERMES_STATUS_ALL"]);
    expect(FROZEN_COMMAND_REGISTRY.HERMES_STATUS_ALL.argv).toEqual(["status", "--all"]);
  });

  it("freezes the exact static argument arrays", () => {
    expect(FROZEN_COMMAND_REGISTRY.HERMES_VERSION.argv).toEqual(["--version"]);
    expect(FROZEN_COMMAND_REGISTRY.HERMES_PROFILE_LIST.argv).toEqual(["profile", "list"]);
    expect(FROZEN_COMMAND_REGISTRY.HERMES_STATUS_ALL.argv).toEqual(["status", "--all"]);
    expect(FROZEN_COMMAND_REGISTRY.HERMES_GATEWAY_LIST.argv).toEqual(["gateway", "list"]);
    expect(FROZEN_COMMAND_REGISTRY.HERMES_GATEWAY_STATUS.argv).toEqual(["gateway", "status"]);
    expect(FROZEN_COMMAND_REGISTRY.HERMES_CRON_STATUS.argv).toEqual(["cron", "status"]);
    expect(FROZEN_COMMAND_REGISTRY.HERMES_CRON_LIST_DEFAULT.argv).toEqual(["cron", "list"]);
    expect(FROZEN_COMMAND_REGISTRY.HERMES_SESSIONS_STATS.argv).toEqual(["sessions", "stats"]);
    expect(FROZEN_COMMAND_REGISTRY.HERMES_INSIGHTS_1D.argv).toEqual(["insights", "--days", "1"]);
    expect(FROZEN_COMMAND_REGISTRY.HERMES_INSIGHTS_7D.argv).toEqual(["insights", "--days", "7"]);
    expect(FROZEN_COMMAND_REGISTRY.HERMES_INSIGHTS_30D.argv).toEqual(["insights", "--days", "30"]);
    expect(FROZEN_COMMAND_REGISTRY.HERMES_SKILLS_ENABLED.argv).toEqual(["skills", "list"]);
    expect(FROZEN_COMMAND_REGISTRY.HERMES_TOOLS_LIST.argv).toEqual(["tools", "list"]);
    expect(FROZEN_COMMAND_REGISTRY.HERMES_MEMORY_STATUS.argv).toEqual(["memory", "status"]);
    expect(FROZEN_COMMAND_REGISTRY.HERMES_KANBAN_BOARDS.argv).toEqual(["kanban", "boards", "list"]);
    expect(FROZEN_COMMAND_REGISTRY.HERMES_KANBAN_BOARD_ITEMS.argv).toEqual([]);
  });

  it("freezes timeout and output classes for every command", () => {
    expect(
      Object.fromEntries(
        COMMAND_IDS.map((id) => [
          id,
          [
            FROZEN_COMMAND_REGISTRY[id].timeoutClass,
            FROZEN_COMMAND_REGISTRY[id].stdoutClass,
          ],
        ]),
      ),
    ).toEqual({
      HERMES_VERSION: ["T1", "SMALL"],
      HERMES_PROFILE_LIST: ["T1", "SMALL"],
      HERMES_STATUS_ALL: ["T1", "SMALL"],
      HERMES_GATEWAY_LIST: ["T1", "SMALL"],
      HERMES_GATEWAY_STATUS: ["T1", "SMALL"],
      HERMES_CRON_STATUS: ["T1", "SMALL"],
      HERMES_CRON_LIST_DEFAULT: ["T2", "MEDIUM"],
      HERMES_SESSIONS_STATS: ["T1", "SMALL"],
      HERMES_INSIGHTS_1D: ["T3", "ANALYTICS"],
      HERMES_INSIGHTS_7D: ["T3", "ANALYTICS"],
      HERMES_INSIGHTS_30D: ["T3", "ANALYTICS"],
      HERMES_SKILLS_ENABLED: ["T2", "MEDIUM"],
      HERMES_TOOLS_LIST: ["T2", "MEDIUM"],
      HERMES_MEMORY_STATUS: ["T1", "SMALL"],
      HERMES_KANBAN_BOARDS: ["T2", "MEDIUM"],
      HERMES_KANBAN_BOARD_ITEMS: ["T2", "MEDIUM"],
    });
  });

  it("constructs board-items argv only from a verified board slug", () => {
    const slug = selectVerifiedBoardSlug("research-board", validatedBoards("research-board"));
    const command = resolveFrozenCommand("HERMES_KANBAN_BOARD_ITEMS", slug);
    expect(command.argv).toEqual(["kanban", "--board", "research-board", "list"]);
  });

  it("does not resolve board-items without a verified slug", () => {
    expect(() => resolveFrozenCommand("HERMES_KANBAN_BOARD_ITEMS")).toThrow();
  });
});
