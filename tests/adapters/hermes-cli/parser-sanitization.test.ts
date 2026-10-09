import { describe, expect, it } from "vitest";

import {
  aliasSensitiveId,
  boundedArray,
  normalizeCliText,
  sanitizeSafeText,
  sanitizeTokenFreeCategory,
} from "../../../src/adapters/hermes-cli/parsers/sanitization.js";

describe("parser sanitization primitives", () => {
  it("removes ANSI, normalizes CRLF, and rejects unsafe control characters", () => {
    expect(normalizeCliText("\u001b[32mStatus\u001b[0m\r\nOK\r\n")).toBe("Status\nOK\n");
    expect(() => normalizeCliText("safe\u0000unsafe")).toThrow("control");
  });

  it.each([
    "/home/example/private/file",
    "~/private/file",
    "C:\\private\\file",
    "sk-synthetic-token-1234567890",
    "ghp_syntheticcredential123456",
    "Bearer synthetic-provider-credential",
    "-1001234567890",
    "Board(/home/synthetic/private)",
    "prefix~/private",
    "chat:-1001234567890",
    "api key : synthetic-secret",
  ])("rejects path, credential, or sensitive identifier text: %s", (value) => {
    expect(() => sanitizeSafeText(value)).toThrow();
  });

  it("normalizes bounded ASCII safe text and rejects unexpected Unicode or long fields", () => {
    expect(sanitizeSafeText("  safe   display name  ")).toBe("safe display name");
    expect(() => sanitizeSafeText("unexpected-☃")).toThrow("ASCII");
    expect(() => sanitizeSafeText("x".repeat(81))).toThrow("length");
  });

  it("creates bounded aliases without preserving raw identifiers", () => {
    expect(aliasSensitiveId("synthetic-sensitive-id", "session", 3)).toBe("session-003");
  });

  it("bounds arrays and controlled categories", () => {
    expect(boundedArray([1, 2], 2)).toEqual([1, 2]);
    expect(() => boundedArray([1, 2, 3], 2)).toThrow("limit");
    expect(sanitizeTokenFreeCategory("local-model")).toBe("local-model");
    expect(() => sanitizeTokenFreeCategory("provider-token=secret")).toThrow();
  });
});
