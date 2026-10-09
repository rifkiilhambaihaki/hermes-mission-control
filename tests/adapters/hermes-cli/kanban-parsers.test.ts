import { describe, expect, it } from "vitest";

import { parseKanbanBoardItemsJson, parseKanbanBoardsJson } from "../../../src/adapters/hermes-cli/parsers/kanban-parsers.js";
import { selectVerifiedBoardSlug } from "../../../src/adapters/hermes-cli/runner/verified-board-slug.js";

const canaries = {
  token: "sk-synthetic-token-canary",
  chat: "-1001234567890",
  path: "/home/synthetic/private.db",
  prompt: "synthetic prompt body must disappear",
  secret: "PROVIDER_SECRET=synthetic",
  title: "synthetic private session title",
  script: "/opt/private/script.py",
};

describe("Kanban JSON parsers", () => {
  it("strictly projects boards and creates verified-slug provenance", () => {
    const result = parseKanbanBoardsJson(
      JSON.stringify({
        version: "1",
        boards: [
          {
            slug: "research-board",
            name: "Research Board",
            database_path: canaries.path,
            workdir: canaries.script,
            internal: true,
          },
        ],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      normalizedData: { boards: [{ slug: "research-board", name: "Research Board" }] },
    });
    if (!result.ok) throw new Error("expected success");
    expect(selectVerifiedBoardSlug("research-board", result.normalizedData.validatedBoards)).toBe("research-board");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(canaries.path);
    expect(serialized).not.toContain(canaries.script);
  });

  it("returns authoritative EMPTY for an empty boards array", () => {
    expect(parseKanbanBoardsJson('{"version":"1","boards":[]}')).toMatchObject({
      ok: true,
      completeness: "EMPTY",
      sanitizedMetadata: { recordCount: 0 },
    });
  });

  it.each([
    ["malformed JSON", "{", "INVALID_JSON"],
    ["wrong version", '{"version":"2","boards":[]}', "INVALID_STRUCTURE"],
    ["unsafe slug", '{"version":"1","boards":[{"slug":"../unsafe","name":"Unsafe"}]}', "INVALID_STRUCTURE"],
    ["duplicate slug", '{"version":"1","boards":[{"slug":"same","name":"One"},{"slug":"same","name":"Two"}]}', "INVALID_STRUCTURE"],
    ["unknown field", '{"version":"1","boards":[{"slug":"safe","name":"Safe","surprise":true}]}', "INVALID_STRUCTURE"],
  ])("rejects %s", (_label, json, errorCode) => {
    expect(parseKanbanBoardsJson(json)).toMatchObject({ ok: false, errorCode });
  });

  it("produces count-only board item summaries and drops all internal canaries", () => {
    const boards = parseKanbanBoardsJson('{"version":"1","boards":[{"slug":"research-board","name":"Research"}]}');
    if (!boards.ok) throw new Error("expected boards success");
    const slug = selectVerifiedBoardSlug("research-board", boards.normalizedData.validatedBoards);
    const result = parseKanbanBoardItemsJson(
      JSON.stringify({
        version: "1",
        board: "research-board",
        database_path: canaries.path,
        items: [
          {
            id: canaries.chat,
            status: "todo",
            prompt: canaries.prompt,
            body: canaries.secret,
            comments: canaries.title,
            workdir: canaries.path,
            link: canaries.token,
            run_context: canaries.script,
            internal: true,
          },
          { id: "synthetic-item-2", status: "done" },
        ],
      }),
      slug,
    );
    expect(result).toMatchObject({
      ok: true,
      normalizedData: {
        boardSlug: "research-board",
        totalCount: 2,
        counts: { TODO: 1, IN_PROGRESS: 0, DONE: 1, BLOCKED: 0 },
      },
    });
    const serialized = JSON.stringify(result);
    for (const canary of Object.values(canaries)) expect(serialized).not.toContain(canary);
  });

  it("rejects duplicate JSON object keys before JSON.parse can overwrite them", () => {
    expect(parseKanbanBoardsJson('{"version":"1","version":"1","boards":[]}')).toMatchObject({
      ok: false,
      errorCode: "INVALID_STRUCTURE",
    });
    expect(
      parseKanbanBoardsJson(
        '{"version":"1","boards":[{"slug":"research","slug":"other","name":"Research"}]}',
      ),
    ).toMatchObject({ ok: false, errorCode: "INVALID_STRUCTURE" });
  });

  it("rejects embedded privacy canaries and oversized dropped values", () => {
    expect(
      parseKanbanBoardsJson(
        JSON.stringify({ version: "1", boards: [{ slug: "research", name: "Board(/home/private/db)" }] }),
      ),
    ).toMatchObject({ ok: false, errorCode: "INVALID_STRUCTURE" });
    const boards = parseKanbanBoardsJson(
      JSON.stringify({ version: "1", boards: [{ slug: "research", name: "Research" }] }),
    );
    if (!boards.ok) throw new Error("fixture must parse");
    const verified = selectVerifiedBoardSlug("research", boards.normalizedData.validatedBoards);
    expect(
      parseKanbanBoardItemsJson(
        JSON.stringify({
          version: "1",
          board: "research",
          items: [{ id: "item-1", status: "todo", prompt: "x".repeat(4_097) }],
        }),
        verified,
      ),
    ).toMatchObject({ ok: false, errorCode: "INVALID_STRUCTURE" });
  });

  it("rejects selector disagreement, duplicate item IDs, unsafe status, and unknown fields", () => {
    const boards = parseKanbanBoardsJson('{"version":"1","boards":[{"slug":"safe-board","name":"Safe"}]}');
    if (!boards.ok) throw new Error("expected boards success");
    const slug = selectVerifiedBoardSlug("safe-board", boards.normalizedData.validatedBoards);
    expect(parseKanbanBoardItemsJson('{"version":"1","board":"other","items":[]}', slug)).toMatchObject({ ok: false });
    expect(parseKanbanBoardItemsJson('{"version":"1","board":"safe-board","items":[{"id":"same","status":"todo"},{"id":"same","status":"done"}]}', slug)).toMatchObject({ ok: false });
    expect(parseKanbanBoardItemsJson('{"version":"1","board":"safe-board","items":[{"id":"one","status":"mystery"}]}', slug)).toMatchObject({ ok: false });
    expect(parseKanbanBoardItemsJson('{"version":"1","board":"safe-board","items":[{"id":"one","status":"todo","unknown":"raw"}]}', slug)).toMatchObject({ ok: false });
  });
});
