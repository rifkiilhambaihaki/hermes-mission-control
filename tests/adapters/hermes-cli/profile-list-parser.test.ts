import { afterEach, describe, expect, it, vi } from "vitest";

import { parseProfileListText } from "../../../src/adapters/hermes-cli/parsers/profile-list-parser.js";

const header = ` ${"Profile".padEnd(16)} ${"Model".padEnd(28)} ${"Gateway".padEnd(12)} ${"Alias".padEnd(12)} Distribution`;
const separator = ` ${"─".repeat(15)}    ${"─".repeat(27)}    ${"─".repeat(11)}    ${"─".repeat(11)}    ${"─".repeat(20)}`;

interface SyntheticRow {
  readonly profile: string;
  readonly current?: boolean;
  readonly model?: string | null;
  readonly gateway?: string;
  readonly alias?: string | null;
  readonly distributionName?: string | null;
  readonly distributionVersion?: string | null;
}

function truncate(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
}

function padMinimum(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - Array.from(value).length))}`;
}

function row({
  profile,
  current = false,
  model = null,
  gateway = "stopped",
  alias = null,
  distributionName = null,
  distributionVersion = null,
}: SyntheticRow): string {
  const marker = current ? " ◆" : "  ";
  const modelDisplay = truncate(model || "—", 26);
  const aliasDisplay = profile === "default" ? "—" : alias || "—";
  const distributionDisplay = distributionName
    ? truncate(`${distributionName}@${distributionVersion || "?"}`, 30)
    : "—";
  return `${marker}${padMinimum(profile, 15)} ${padMinimum(modelDisplay, 28)} ${padMinimum(gateway, 12)} ${padMinimum(aliasDisplay, 12)} ${distributionDisplay}`;
}

function output(rows: readonly string[]): string {
  return `\n${header}\n${separator}\n${rows.join("\n")}\n\n`;
}

function expectMismatch(value: string): void {
  expect(parseProfileListText(value)).toMatchObject({ ok: false });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Hermes 0.16.0 dedicated profile-list parser", () => {
  it("parses one marked profile and projects current semantics", () => {
    expect(parseProfileListText(output([row({ profile: "default", current: true })]))).toMatchObject({
      ok: true,
      completeness: "COMPLETE",
      normalizedData: { profiles: [{ name: "default", current: true }] },
      sanitizedMetadata: { recordCount: 1 },
    });
  });

  it("accepts one unmarked profile because current HERMES_HOME may be custom", () => {
    expect(parseProfileListText(output([row({ profile: "research" })]))).toMatchObject({
      ok: true,
      normalizedData: { profiles: [{ name: "research", current: false }] },
    });
  });

  it("parses multiple profiles with the marked first profile", () => {
    expect(
      parseProfileListText(
        output([
          row({ profile: "default", current: true, gateway: "running" }),
          row({ profile: "research" }),
        ]),
      ),
    ).toMatchObject({
      ok: true,
      normalizedData: {
        profiles: [
          { name: "default", current: true },
          { name: "research", current: false },
        ],
      },
      sanitizedMetadata: { recordCount: 2 },
    });
  });

  it("accepts a marked non-first profile", () => {
    expect(
      parseProfileListText(
        output([
          row({ profile: "default" }),
          row({ profile: "research", current: true }),
        ]),
      ),
    ).toMatchObject({
      ok: true,
      normalizedData: {
        profiles: [
          { name: "default", current: false },
          { name: "research", current: true },
        ],
      },
    });
  });

  it("accepts zero marked rows without inventing a current profile", () => {
    const result = parseProfileListText(
      output([row({ profile: "default" }), row({ profile: "research" })]),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.normalizedData.profiles.every((profile) => !profile.current)).toBe(true);
  });

  it("rejects two marked rows", () => {
    expectMismatch(
      output([
        row({ profile: "default", current: true }),
        row({ profile: "research", current: true }),
      ]),
    );
  });

  it("treats the exact empty sentence as authoritative EMPTY", () => {
    expect(parseProfileListText("No profiles found.\n")).toMatchObject({
      ok: true,
      completeness: "EMPTY",
      normalizedData: { profiles: [] },
      sanitizedMetadata: { recordCount: 0 },
    });
  });

  it("handles a profile identifier longer than display width 15", () => {
    const profile = "research-profile-long";
    expect(parseProfileListText(output([row({ profile, current: true })]))).toMatchObject({
      ok: true,
      normalizedData: { profiles: [{ name: profile, current: true }] },
    });
  });

  it("accepts a profile identifier of exactly 64 characters", () => {
    const profile = `a${"b".repeat(63)}`;
    expect(parseProfileListText(output([row({ profile })]))).toMatchObject({
      ok: true,
      normalizedData: { profiles: [{ name: profile, current: false }] },
    });
  });

  it("rejects profile identifiers longer than 64 characters", () => {
    expectMismatch(output([row({ profile: `a${"b".repeat(64)}` })]));
  });

  it("accepts lowercase identifiers containing hyphen and underscore", () => {
    expect(parseProfileListText(output([row({ profile: "research-one_two" })]))).toMatchObject({
      ok: true,
      normalizedData: { profiles: [{ name: "research-one_two", current: false }] },
    });
  });

  it("rejects duplicate profile identifiers", () => {
    expectMismatch(output([row({ profile: "research" }), row({ profile: "research" })]));
  });

  it.each(["unexpected-☃", "../profile", "profile/name", "Uppercase", "_leading"])(
    "rejects invalid profile identifier %s",
    (profile) => expectMismatch(output([row({ profile })])),
  );

  it("accepts the model em-dash placeholder", () => {
    expect(parseProfileListText(output([row({ profile: "research", model: null })]))).toMatchObject({
      ok: true,
    });
  });

  it("accepts a long model only in the exact upstream 26-code-point truncation", () => {
    const longModel = "provider/model-with-a-very-long-display-name";
    expect(parseProfileListText(output([row({ profile: "research", model: longModel })]))).toMatchObject({
      ok: true,
    });
    const valid = row({ profile: "research", model: longModel });
    const modelStart = valid.indexOf(truncate(longModel, 26));
    const malformed = `${valid.slice(0, modelStart)}${"m".repeat(27)} ${valid.slice(modelStart + 28)}`;
    expectMismatch(output([malformed]));
  });

  it.each(["running", "stopped"])("accepts controlled gateway value %s", (gateway) => {
    expect(parseProfileListText(output([row({ profile: "research", gateway })]))).toMatchObject({ ok: true });
  });

  it("rejects an invalid gateway value", () => {
    expectMismatch(output([row({ profile: "research", gateway: "unknown" })]));
  });

  it("accepts the alias em-dash placeholder", () => {
    expect(parseProfileListText(output([row({ profile: "research", alias: null })]))).toMatchObject({
      ok: true,
    });
  });

  it("accepts an untruncated alias longer than its minimum display width", () => {
    expect(
      parseProfileListText(
        output([row({ profile: "research", alias: "a".repeat(400) })]),
      ),
    ).toMatchObject({ ok: true });
  });

  it("accepts absent distribution and the upstream unknown-version placeholder", () => {
    expect(
      parseProfileListText(
        output([
          row({ profile: "plain", distributionName: null }),
          row({ profile: "packaged", distributionName: "telemetry", distributionVersion: null }),
        ]),
      ),
    ).toMatchObject({ ok: true, sanitizedMetadata: { recordCount: 2 } });
  });

  it("accepts exact 30-code-point distribution truncation", () => {
    expect(
      parseProfileListText(
        output([
          row({
            profile: "packaged",
            distributionName: "distribution-name-longer-than-thirty-characters",
            distributionVersion: "1.2.3",
          }),
        ]),
      ),
    ).toMatchObject({ ok: true });
  });

  it("uses Unicode code points for truncated dropped display fields", () => {
    expect(
      parseProfileListText(
        output([
          row({
            profile: "unicode-safe",
            model: `${"m".repeat(25)}😀truncated`,
            alias: "alias-😀-value",
            distributionName: `${"d".repeat(29)}😀truncated`,
            distributionVersion: "1",
          }),
        ]),
      ),
    ).toMatchObject({ ok: true });
  });

  it("rejects missing, altered, and reordered headers", () => {
    const valid = output([row({ profile: "research" })]);
    expectMismatch(valid.replace(`${header}\n`, ""));
    expectMismatch(valid.replace("Profile", "Profiles"));
    expectMismatch(valid.replace("Profile", "MODEL").replace("Model", "Profile"));
  });

  it("rejects a malformed Unicode separator", () => {
    expectMismatch(output([row({ profile: "research" })]).replace("─", "-"));
  });

  it("rejects an unknown marker", () => {
    const unknownMarker = row({ profile: "research" }).replace(/^  /u, " ✓");
    expectMismatch(output([unknownMarker]));
  });

  it("rejects unexpected prefix and suffix lines", () => {
    const valid = output([row({ profile: "research" })]);
    expectMismatch(`unexpected\n${valid}`);
    expectMismatch(`${valid}unexpected\n`);
  });

  it("rejects an unexpected extra column", () => {
    const extra = `${row({ profile: "research" })} EXTRA`;
    expectMismatch(output([extra]));
  });

  it("rejects a structurally ambiguous alias/distribution tail", () => {
    const ambiguous = row({
      profile: "research",
      alias: "alias-longer-than-twelve",
      distributionName: "first second",
      distributionVersion: "1",
    });
    expectMismatch(output([ambiguous]));
  });

  it("accepts CRLF and permitted boundary blank lines", () => {
    const valid = output([row({ profile: "research", current: true })]);
    expect(parseProfileListText(valid.replace(/\n/g, "\r\n"))).toMatchObject({ ok: true });
    expect(parseProfileListText(` \n\t\n${valid}\n \n`)).toMatchObject({ ok: true });
  });

  it("rejects ANSI contamination because the upstream formatter is uncolored", () => {
    const valid = output([row({ profile: "research" })]);
    expectMismatch(valid.replace("Profile", "\u001b[32mProfile\u001b[0m"));
  });

  it("rejects parser-side oversized output and oversized rows", () => {
    expectMismatch("x".repeat(128 * 1_024 + 1));
    const hugeAlias = "a".repeat(600);
    expectMismatch(output([row({ profile: "research", alias: hugeAlias })]));
  });

  it("validates then drops privacy canaries without logging or returning them", () => {
    const canaries = [
      "/fake/path",
      "fake token",
      "credential@secret",
      "provider-secret",
      "internal-metadata",
    ];
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    const result = parseProfileListText(
      output([
        row({
          profile: "one",
          model: "/fake/path",
          alias: "fake token",
          distributionName: "credential",
          distributionVersion: "secret",
        }),
        row({
          profile: "two",
          model: "internal-metadata",
          alias: "provider-secret",
        }),
      ]),
    );

    expect(result).toMatchObject({
      ok: true,
      normalizedData: {
        profiles: [
          { name: "one", current: false },
          { name: "two", current: false },
        ],
      },
    });
    const serialized = JSON.stringify(result);
    for (const canary of canaries) expect(serialized).not.toContain(canary);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });

  it("does not echo malformed dropped-field canaries in failures", () => {
    const canary = "fake-provider-secret";
    const result = parseProfileListText(output([row({ profile: "research", gateway: canary })]));
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain(canary);
  });
});
