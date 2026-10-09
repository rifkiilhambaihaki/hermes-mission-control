declare const validatedKanbanBoardsBrand: unique symbol;
declare const verifiedKanbanBoardSlugBrand: unique symbol;

export interface ValidatedKanbanBoardsResult {
  readonly sourceCommandId: "HERMES_KANBAN_BOARDS";
  readonly boardSlugs: readonly string[];
  readonly [validatedKanbanBoardsBrand]: true;
}

export type VerifiedKanbanBoardSlug = string & {
  readonly [verifiedKanbanBoardSlugBrand]: true;
};

const STRICT_BOARD_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_BOARD_SLUG_LENGTH = 63;

export function validatedKanbanBoardsResultFromParser(
  boardSlugs: readonly string[],
): ValidatedKanbanBoardsResult {
  if (
    boardSlugs.length > 100 ||
    new Set(boardSlugs).size !== boardSlugs.length ||
    boardSlugs.some(
      (slug) =>
        slug.length === 0 ||
        slug.length > MAX_BOARD_SLUG_LENGTH ||
        !STRICT_BOARD_SLUG.test(slug),
    )
  ) {
    throw new Error("Validated Kanban board slugs are invalid.");
  }
  return Object.freeze({
    sourceCommandId: "HERMES_KANBAN_BOARDS" as const,
    boardSlugs: Object.freeze([...boardSlugs]),
  }) as ValidatedKanbanBoardsResult;
}

export function selectVerifiedBoardSlug(
  candidate: string,
  boards: ValidatedKanbanBoardsResult,
): VerifiedKanbanBoardSlug {
  if (boards.sourceCommandId !== "HERMES_KANBAN_BOARDS") {
    throw new Error("Kanban board provenance is invalid.");
  }
  if (
    candidate.length === 0 ||
    candidate.length > MAX_BOARD_SLUG_LENGTH ||
    !STRICT_BOARD_SLUG.test(candidate)
  ) {
    throw new Error("Kanban board slug is invalid.");
  }
  if (!Array.isArray(boards.boardSlugs) || !boards.boardSlugs.includes(candidate)) {
    throw new Error("Kanban board slug is not present in the validated boards result.");
  }
  return candidate as VerifiedKanbanBoardSlug;
}
