import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PARSER_COMMAND_IDS, parseHermesRunnerResult } from "../../../src/adapters/hermes-cli/parsers/parser-registry.js";
import type {
  BoundedProcessResult,
  SanitizedRunnerErrorCode,
  SuccessfulProcessResult,
} from "../../../src/adapters/hermes-cli/runner/bounded-process-executor.js";
import {
  DEFERRED_NOT_VALIDATED_COMMAND_IDS,
  NOT_APPROVED_COMMAND_IDS,
  RETIRED_LIVE_MONITORING_COMMAND_IDS,
  type HermesCommandId,
} from "../../../src/adapters/hermes-cli/runner/command-registry.js";
import {
  parserCompatibilityAuthorityFromLocalMetadata,
  type ParserCompatibilityAuthority,
} from "../../../src/adapters/hermes-version-metadata/compatibility-authority.js";
import {
  LocalHermesInstallationDescriptor,
  LocalHermesVersionMetadataAdapter,
} from "../../../src/adapters/hermes-version-metadata/local-hermes-version-metadata-adapter.js";

let syntheticRoot: string;
let supportedAuthority: ParserCompatibilityAuthority | null = null;

beforeAll(async () => {
  syntheticRoot = await mkdtemp(resolve(tmpdir(), "hermes-parser-authority-"));
  const sitePackagesRoot = resolve(syntheticRoot, "site-packages");
  const metadataDirectory = resolve(sitePackagesRoot, "hermes_agent-0.16.0.dist-info");
  const sourceRoot = resolve(syntheticRoot, "source");
  await mkdir(metadataDirectory, { recursive: true });
  await mkdir(resolve(sourceRoot, "hermes_cli"), { recursive: true });
  await writeFile(resolve(metadataDirectory, "METADATA"), "Name: hermes-agent\nVersion: 0.16.0\n");
  const descriptor = LocalHermesInstallationDescriptor.fromApprovedServerConfiguration({
    sitePackagesRoot,
    distributionMetadataDirectory: metadataDirectory,
    editableSourceRoot: sourceRoot,
  });
  const result = await new LocalHermesVersionMetadataAdapter(descriptor).read();
  supportedAuthority = parserCompatibilityAuthorityFromLocalMetadata(result);
  if (supportedAuthority === null) throw new Error("Synthetic metadata authority setup failed.");
});

afterAll(async () => {
  await rm(syntheticRoot, { recursive: true, force: true });
});

function success(commandId: HermesCommandId, stdout: string | Buffer, stderr = ""): SuccessfulProcessResult {
  const rawStdout = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  const rawStderr = Buffer.from(stderr);
  return {
    commandId,
    category: "SUCCESS",
    startTime: "2027-01-01T00:00:00.000Z",
    endTime: "2027-01-01T00:00:00.001Z",
    durationMs: 1,
    exitCode: 0,
    signal: null,
    stdoutBytes: rawStdout.length,
    stderrBytes: rawStderr.length,
    timedOut: false,
    outputLimitExceeded: false,
    forcedKill: false,
    errorCode: "NONE",
    rawStdout,
    rawStderr,
  };
}

function failed(
  commandId: HermesCommandId,
  category: "UNAVAILABLE" | "UNKNOWN",
  errorCode: SanitizedRunnerErrorCode,
): BoundedProcessResult {
  return {
    commandId,
    category,
    startTime: "2027-01-01T00:00:00.000Z",
    endTime: "2027-01-01T00:00:00.001Z",
    durationMs: 1,
    exitCode: null,
    signal: null,
    stdoutBytes: 0,
    stderrBytes: 0,
    timedOut: errorCode === "TIMEOUT",
    outputLimitExceeded: category === "UNKNOWN",
    forcedKill: false,
    errorCode,
  };
}

describe("parser registry boundary", () => {
  it("exposes only the live-validated profile parser", () => {
    expect(PARSER_COMMAND_IDS).toEqual(["HERMES_PROFILE_LIST"]);
  });

  it.each(RETIRED_LIVE_MONITORING_COMMAND_IDS)(
    "rejects retired %s before decoding synthetic output",
    (commandId) => {
      const canary = `synthetic-retired-canary-${commandId}`;
      const result = parseHermesRunnerResult(success(commandId, canary), {
        versionAuthority: supportedAuthority,
      });
      expect(result).toMatchObject({ ok: false, errorCode: "COMMAND_RETIRED" });
      expect(JSON.stringify(result)).not.toContain(canary);
    },
  );

  it.each([...NOT_APPROVED_COMMAND_IDS, ...DEFERRED_NOT_VALIDATED_COMMAND_IDS])(
    "rejects non-validated %s before decoding synthetic output",
    (commandId) => {
      const canary = `synthetic-non-validated-canary-${commandId}`;
      const result = parseHermesRunnerResult(success(commandId, canary), {
        versionAuthority: supportedAuthority,
      });
      expect(result).toMatchObject({
        ok: false,
        errorCode: "COMMAND_NOT_LIVE_VALIDATED",
      });
      expect(JSON.stringify(result)).not.toContain(canary);
    },
  );

  it("requires local-metadata compatibility authority before profile parsing", () => {
    expect(
      parseHermesRunnerResult(
        success("HERMES_PROFILE_LIST", "synthetic raw output that must not be parsed"),
        { versionAuthority: null },
      ),
    ).toMatchObject({ ok: false, errorCode: "UNSUPPORTED_VERSION" });
  });

  it("rejects a structurally forged parser compatibility authority", () => {
    const forgedAuthority = {
      version: "0.16.0",
      source: "LOCAL_HERMES_VERSION_METADATA",
    } as never;
    expect(
      parseHermesRunnerResult(success("HERMES_PROFILE_LIST", "synthetic raw output"), {
        versionAuthority: forgedAuthority,
      }),
    ).toMatchObject({ ok: false, errorCode: "UNSUPPORTED_VERSION" });
  });

  it.each([
    ["TIMEOUT", "TIMEOUT"],
    ["EXECUTABLE_NOT_FOUND", "EXECUTABLE_NOT_FOUND"],
    ["PERMISSION_DENIED", "PERMISSION_DENIED"],
  ] as const)("maps runner %s to sanitized RUNNER_UNAVAILABLE", (errorCode, expected) => {
    expect(
      parseHermesRunnerResult(failed("HERMES_PROFILE_LIST", "UNAVAILABLE", errorCode), {
        versionAuthority: supportedAuthority,
      }),
    ).toMatchObject({ ok: false, errorCode: "RUNNER_UNAVAILABLE", runnerErrorCode: expected });
  });

  it("rejects deferred Kanban failures before runner failure mapping", () => {
    const result = parseHermesRunnerResult(
      failed("HERMES_KANBAN_BOARDS", "UNAVAILABLE", "EXECUTABLE_NOT_FOUND"),
      { versionAuthority: supportedAuthority },
    );
    expect(result).toMatchObject({
      ok: false,
      errorCode: "COMMAND_NOT_LIVE_VALIDATED",
      sanitizedMetadata: { sourceFormat: "JSON", recordCount: 0 },
    });
  });

  it("maps bounded output truncation to TRUNCATED_OUTPUT", () => {
    expect(
      parseHermesRunnerResult(failed("HERMES_PROFILE_LIST", "UNKNOWN", "STDOUT_LIMIT_EXCEEDED"), {
        versionAuthority: supportedAuthority,
      }),
    ).toMatchObject({ ok: false, errorCode: "TRUNCATED_OUTPUT" });
  });

  it("rejects invalid UTF-8 without exposing raw bytes", () => {
    const result = parseHermesRunnerResult(success("HERMES_PROFILE_LIST", Buffer.from([0xc3, 0x28])), {
      versionAuthority: supportedAuthority,
    });
    expect(result).toMatchObject({ ok: false, errorCode: "INVALID_STRUCTURE" });
    expect(JSON.stringify(result)).not.toContain("rawStdout");
    expect(JSON.stringify(result)).not.toContain("rawStderr");
  });

  it("rejects invalid UTF-8 before dedicated profile parsing", () => {
    const result = parseHermesRunnerResult(
      success("HERMES_PROFILE_LIST", Buffer.from([0xc3, 0x28])),
      { versionAuthority: supportedAuthority },
    );
    expect(result).toMatchObject({ ok: false, errorCode: "INVALID_STRUCTURE" });
    expect(JSON.stringify(result)).not.toContain("rawStdout");
  });

  it("discards stderr content and emits only a controlled warning", () => {
    const canary = "synthetic stderr token sk-syn...nary";
    const result = parseHermesRunnerResult(
      success("HERMES_PROFILE_LIST", "No profiles found.\n", canary),
      { versionAuthority: supportedAuthority },
    );
    expect(result).toMatchObject({ ok: true, warnings: ["SOURCE_STDERR_DISCARDED"] });
    expect(JSON.stringify(result)).not.toContain(canary);
  });
});
