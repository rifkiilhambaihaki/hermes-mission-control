import { describe, expect, it } from "vitest";

import {
  PARSER_COMPATIBILITY_REGISTRY,
  SUPPORTED_HERMES_VERSION,
  parseHermesVersionText,
  parserCompatibilityFor,
} from "../../../src/adapters/hermes-cli/parsers/compatibility.js";
import { PARSER_COMMAND_IDS } from "../../../src/adapters/hermes-cli/parsers/parser-registry.js";

describe("Hermes parser compatibility", () => {
  it("supports exactly Hermes 0.16.0 only for parser-approved commands", () => {
    expect(SUPPORTED_HERMES_VERSION).toBe("0.16.0");
    expect(Object.keys(PARSER_COMPATIBILITY_REGISTRY)).toEqual(["0.16.0"]);
    expect(PARSER_COMPATIBILITY_REGISTRY["0.16.0"].commandIds).toEqual([
      "HERMES_PROFILE_LIST",
    ]);
    expect(PARSER_COMMAND_IDS).toEqual(["HERMES_PROFILE_LIST"]);
    expect(parserCompatibilityFor("0.16.0", "HERMES_VERSION")).toBeNull();
    expect(parserCompatibilityFor("0.16.0", "HERMES_STATUS_ALL")).toBeNull();
    expect(parserCompatibilityFor("0.16.0", "HERMES_GATEWAY_STATUS")).toBeNull();
    expect(parserCompatibilityFor("0.16.0", "HERMES_CRON_STATUS")).toBeNull();
    expect(parserCompatibilityFor("0.16.0", "HERMES_PROFILE_LIST")).not.toBeNull();
  });

  it.each([
    "Hermes Agent 0.16.0",
    "  Hermes   Agent   0.16.0  \n",
    "\u001b[36mHermes Agent 0.16.0\u001b[0m\r\n",
  ])("accepts harmless whitespace/ANSI for the exact version: %j", (text) => {
    expect(parseHermesVersionText(text)).toMatchObject({
      ok: true,
      normalizedData: { version: "0.16.0" },
    });
  });

  it("returns UNSUPPORTED_VERSION without best-effort fallback", () => {
    expect(parseHermesVersionText("Hermes Agent 0.17.0")).toMatchObject({
      ok: false,
      errorCode: "UNSUPPORTED_VERSION",
    });
    expect(parserCompatibilityFor("0.17.0", "HERMES_STATUS_ALL")).toBeNull();
  });

  it("distinguishes truncated version output", () => {
    expect(parseHermesVersionText("Hermes Agent 0.16.0\n[output truncated]\n")).toMatchObject({
      ok: false,
      errorCode: "TRUNCATED_OUTPUT",
    });
  });

  it.each([
    "",
    "Hermes 0.16.0",
    "Hermes Agent version 0.16.0",
    "Hermes Agent 0.16.0 extra",
    "Hermes Agent 0.16.0\nHermes Agent 0.16.0",
    "Hermes Agent 0,16,0",
    `Hermes Agent ${"1".repeat(100)}`,
    "Hermes Agent 0.16.☃",
  ])(
    "rejects changed version structures: %j",
    (text) => {
      expect(parseHermesVersionText(text)).toMatchObject({
        ok: false,
        errorCode: "PARSER_MISMATCH",
      });
    },
  );
});
