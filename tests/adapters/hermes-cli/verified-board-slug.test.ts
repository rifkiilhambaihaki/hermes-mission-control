import { describe, expect, it } from "vitest";

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

describe("verified Kanban board slug", () => {
  it.each(["default", "research", "research-board", "board-2027"])(
    "accepts strict slug %s only when present in a validated boards result",
    (candidate) => {
      expect(String(selectVerifiedBoardSlug(candidate, validatedBoards(candidate)))).toBe(candidate);
    },
  );

  it.each([
    "",
    "Research",
    "has space",
    "../escape",
    "/absolute",
    "under_score",
    "double--dash",
    "-leading",
    "trailing-",
    "a".repeat(64),
  ])("rejects invalid candidate %s", (candidate) => {
    expect(() => selectVerifiedBoardSlug(candidate, validatedBoards(candidate))).toThrow();
  });

  it("rejects a valid slug absent from the validated registry result", () => {
    expect(() => selectVerifiedBoardSlug("other", validatedBoards("default"))).toThrow();
  });

  it("rejects the wrong provenance command", () => {
    const forged = {
      sourceCommandId: "HERMES_PROFILE_LIST",
      boardSlugs: ["default"],
    } as unknown as ValidatedKanbanBoardsResult;
    expect(() => selectVerifiedBoardSlug("default", forged)).toThrow();
  });
});
