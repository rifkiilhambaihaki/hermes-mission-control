import type { KanbanBoardSummary, ParserResult } from "./contracts.js";
import { parserFailure, parserSuccess } from "./result-builders.js";
import { boundedArray, sanitizeSafeText } from "./sanitization.js";
import { DuplicateJsonKeyError, parseStrictJson } from "./strict-json.js";
import {
  validatedKanbanBoardsResultFromParser,
  type VerifiedKanbanBoardSlug,
} from "../runner/verified-board-slug.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const approved = new Set(allowed);
  return Object.keys(value).every((key) => approved.has(key));
}

function optionalBoundedString(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length <= 4_096);
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function parseJson(
  text: string,
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly errorCode: "INVALID_JSON" | "INVALID_STRUCTURE" } {
  try {
    return { ok: true, value: parseStrictJson(text) };
  } catch (error) {
    return {
      ok: false,
      errorCode: error instanceof DuplicateJsonKeyError ? "INVALID_STRUCTURE" : "INVALID_JSON",
    };
  }
}

export function parseKanbanBoardsJson(text: string): ParserResult<"HERMES_KANBAN_BOARDS"> {
  const parsed = parseJson(text);
  if (!parsed.ok) return parserFailure("HERMES_KANBAN_BOARDS", parsed.errorCode, "JSON");
  try {
    if (
      !isRecord(parsed.value) ||
      !hasOnlyKeys(parsed.value, ["version", "boards", "database_path", "workdir", "internal"]) ||
      parsed.value.version !== "1" ||
      !Array.isArray(parsed.value.boards) ||
      !optionalBoundedString(parsed.value.database_path) ||
      !optionalBoundedString(parsed.value.workdir) ||
      !optionalBoolean(parsed.value.internal)
    ) {
      throw new Error("invalid boards envelope");
    }
    const boards: KanbanBoardSummary[] = parsed.value.boards.map((candidate: unknown) => {
      if (
        !isRecord(candidate) ||
        !hasOnlyKeys(candidate, ["slug", "name", "database_path", "workdir", "created_at", "internal"]) ||
        typeof candidate.slug !== "string" ||
        typeof candidate.name !== "string" ||
        !optionalBoundedString(candidate.database_path) ||
        !optionalBoundedString(candidate.workdir) ||
        !optionalBoundedString(candidate.created_at) ||
        !optionalBoolean(candidate.internal)
      ) {
        throw new Error("invalid board record");
      }
      return {
        slug: candidate.slug,
        name: sanitizeSafeText(candidate.name, { maxLength: 80 }),
      };
    });
    boundedArray(boards, 100);
    const validatedBoards = validatedKanbanBoardsResultFromParser(boards.map((board) => board.slug));
    return parserSuccess(
      "HERMES_KANBAN_BOARDS",
      { boards: Object.freeze(boards), validatedBoards },
      boards.length === 0 ? "EMPTY" : "COMPLETE",
      boards.length,
      [],
      "JSON",
    );
  } catch {
    return parserFailure("HERMES_KANBAN_BOARDS", "INVALID_STRUCTURE", "JSON");
  }
}

export function parseKanbanBoardItemsJson(
  text: string,
  boardSlug: VerifiedKanbanBoardSlug,
): ParserResult<"HERMES_KANBAN_BOARD_ITEMS"> {
  const parsed = parseJson(text);
  if (!parsed.ok) return parserFailure("HERMES_KANBAN_BOARD_ITEMS", parsed.errorCode, "JSON");
  try {
    if (
      !isRecord(parsed.value) ||
      !hasOnlyKeys(parsed.value, ["version", "board", "items", "database_path", "workdir", "internal"]) ||
      parsed.value.version !== "1" ||
      parsed.value.board !== String(boardSlug) ||
      !Array.isArray(parsed.value.items) ||
      !optionalBoundedString(parsed.value.database_path) ||
      !optionalBoundedString(parsed.value.workdir) ||
      !optionalBoolean(parsed.value.internal)
    ) {
      throw new Error("invalid board items envelope");
    }
    const ids = new Set<string>();
    const counts = { TODO: 0, IN_PROGRESS: 0, DONE: 0, BLOCKED: 0 };
    for (const candidate of boundedArray(parsed.value.items, 1_000)) {
      if (
        !isRecord(candidate) ||
        !hasOnlyKeys(candidate, [
          "id",
          "status",
          "prompt",
          "body",
          "comments",
          "workdir",
          "link",
          "run_context",
          "internal",
        ]) ||
        typeof candidate.id !== "string" ||
        candidate.id.length === 0 ||
        candidate.id.length > 256 ||
        typeof candidate.status !== "string" ||
        !optionalBoundedString(candidate.prompt) ||
        !optionalBoundedString(candidate.body) ||
        !optionalBoundedString(candidate.comments) ||
        !optionalBoundedString(candidate.workdir) ||
        !optionalBoundedString(candidate.link) ||
        !optionalBoundedString(candidate.run_context) ||
        !optionalBoolean(candidate.internal) ||
        ids.has(candidate.id)
      ) {
        throw new Error("invalid board item");
      }
      ids.add(candidate.id);
      const status = candidate.status.toLowerCase();
      if (status === "todo") counts.TODO += 1;
      else if (status === "in_progress") counts.IN_PROGRESS += 1;
      else if (status === "done") counts.DONE += 1;
      else if (status === "blocked") counts.BLOCKED += 1;
      else throw new Error("unknown board status");
    }
    const totalCount = parsed.value.items.length;
    return parserSuccess(
      "HERMES_KANBAN_BOARD_ITEMS",
      { boardSlug, totalCount, counts: Object.freeze(counts) },
      totalCount === 0 ? "EMPTY" : "COMPLETE",
      totalCount,
      [],
      "JSON",
    );
  } catch {
    return parserFailure("HERMES_KANBAN_BOARD_ITEMS", "INVALID_STRUCTURE", "JSON");
  }
}
