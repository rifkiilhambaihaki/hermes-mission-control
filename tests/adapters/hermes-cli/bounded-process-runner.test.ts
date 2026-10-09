import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  executeBoundedProcess,
  type BoundedProcessSpec,
  type RunnerLogEntry,
} from "../../../src/adapters/hermes-cli/runner/bounded-process-executor.js";
import {
  RegisteredCommandScheduler,
  DuplicateCommandExecutionError,
} from "../../../src/adapters/hermes-cli/runner/registered-command-scheduler.js";
import { LIVE_MONITORING_COMMAND_IDS } from "../../../src/adapters/hermes-cli/runner/command-registry.js";

const fixturePath = fileURLToPath(new URL("../../fixtures/synthetic-child.mjs", import.meta.url));
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "hmc-runner-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function environment(home: string): NodeJS.ProcessEnv {
  return {
    PATH: "/usr/bin:/bin",
    HOME: home,
    HERMES_HOME: join(home, ".hermes-test"),
    NO_COLOR: "1",
    TERM: "dumb",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TZ: "Asia/Jakarta",
  };
}

function spec(
  directory: string,
  mode: string,
  args: readonly string[] = [],
  overrides: Partial<BoundedProcessSpec> = {},
): BoundedProcessSpec {
  return {
    commandId: "HERMES_VERSION",
    executable: process.execPath,
    argv: [fixturePath, mode, ...args],
    workingDirectory: directory,
    environment: environment(directory),
    timeoutMs: 1_000,
    stdoutLimitBytes: 128 * 1_024,
    stderrLimitBytes: 64 * 1_024,
    terminationGraceMs: 500,
    ...overrides,
  };
}

async function eventuallyProcessGone(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("bounded process executor", () => {
  it("returns bounded raw output only for a successful process", async () => {
    const directory = await temporaryDirectory();
    const result = await executeBoundedProcess(spec(directory, "success", ["expected-output"]));
    expect(result.category).toBe("SUCCESS");
    if (result.category !== "SUCCESS") throw new Error("expected success");
    expect(result.rawStdout.toString("utf8")).toBe("expected-output");
    expect(result.rawStderr.length).toBe(0);
    expect(result.stdoutBytes).toBe(Buffer.byteLength("expected-output"));
  });

  it("captures bounded stderr for a successful process without logging output, argv, or environment", async () => {
    const directory = await temporaryDirectory();
    const logs: RunnerLogEntry[] = [];
    const secretArgument = "private-board-slug";
    const result = await executeBoundedProcess(
      spec(directory, "stderr-success", [secretArgument]),
      (entry) => logs.push(entry),
    );
    expect(result.category).toBe("SUCCESS");
    if (result.category !== "SUCCESS") throw new Error("expected success");
    expect(result.rawStderr.toString("utf8")).toBe("synthetic-warning");
    expect(logs).toHaveLength(2);
    expect(Object.keys(logs[0] ?? {}).sort()).toEqual(["commandId", "phase", "startTime"]);
    expect(Object.keys(logs[1] ?? {}).sort()).toEqual([
      "category",
      "commandId",
      "durationMs",
      "endTime",
      "errorCode",
      "forcedKill",
      "outputLimitExceeded",
      "phase",
      "startTime",
      "stderrBytes",
      "stdoutBytes",
      "timedOut",
    ]);
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain("synthetic-warning");
    expect(serializedLogs).not.toContain(secretArgument);
    expect(serializedLogs).not.toContain(fixturePath);
    expect(serializedLogs).not.toContain(process.execPath);
    expect(serializedLogs).not.toContain(directory);
    expect(serializedLogs).not.toContain("HERMES_HOME");
  });

  it("maps a nonzero exit to UNAVAILABLE and discards partial output", async () => {
    const directory = await temporaryDirectory();
    const result = await executeBoundedProcess(spec(directory, "nonzero", ["7"]));
    expect(result).toMatchObject({
      category: "UNAVAILABLE",
      errorCode: "NONZERO_EXIT",
      exitCode: 7,
    });
    expect("rawStdout" in result).toBe(false);
    expect("rawStderr" in result).toBe(false);
  });

  it("maps a missing executable to sanitized UNAVAILABLE", async () => {
    const directory = await temporaryDirectory();
    const result = await executeBoundedProcess({
      ...spec(directory, "success"),
      executable: join(directory, "does-not-exist"),
      argv: [],
    });
    expect(result).toMatchObject({ category: "UNAVAILABLE", errorCode: "EXECUTABLE_NOT_FOUND" });
  });

  it("maps executable permission failure to sanitized UNAVAILABLE", async () => {
    const directory = await temporaryDirectory();
    const blockedExecutable = join(directory, "blocked-executable");
    await writeFile(blockedExecutable, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(blockedExecutable, 0o600);
    const result = await executeBoundedProcess({
      ...spec(directory, "success"),
      executable: blockedExecutable,
      argv: [],
    });
    expect(result).toMatchObject({ category: "UNAVAILABLE", errorCode: "PERMISSION_DENIED" });
  });

  it("times out, terminates, and discards partial output", async () => {
    const directory = await temporaryDirectory();
    const result = await executeBoundedProcess(spec(directory, "timeout", [], { timeoutMs: 80 }));
    expect(result).toMatchObject({
      category: "UNAVAILABLE",
      errorCode: "TIMEOUT",
      timedOut: true,
    });
    expect("rawStdout" in result).toBe(false);
  });

  it("escalates from SIGTERM to SIGKILL after the bounded grace period", async () => {
    const directory = await temporaryDirectory();
    const started = Date.now();
    const result = await executeBoundedProcess(
      spec(directory, "ignore-term", [], { timeoutMs: 300, terminationGraceMs: 100 }),
    );
    expect(result).toMatchObject({ category: "UNAVAILABLE", errorCode: "TIMEOUT", forcedKill: true });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it.each([
    ["oversized-stdout", "STDOUT_LIMIT_EXCEEDED"],
    ["oversized-stderr", "STDERR_LIMIT_EXCEEDED"],
  ] as const)("maps %s to UNKNOWN and never exposes truncated bytes", async (mode, errorCode) => {
    const directory = await temporaryDirectory();
    const result = await executeBoundedProcess(
      spec(directory, mode, ["4096"], {
        stdoutLimitBytes: 1_024,
        stderrLimitBytes: 1_024,
      }),
    );
    expect(result).toMatchObject({ category: "UNKNOWN", errorCode, outputLimitExceeded: true });
    expect("rawStdout" in result).toBe(false);
    expect("rawStderr" in result).toBe(false);
  });

  it("passes only the explicitly supplied environment", async () => {
    const directory = await temporaryDirectory();
    process.env.SYNTHETIC_PROVIDER_API_KEY = "provider-canary-must-not-pass";
    process.env.SYNTHETIC_TELEGRAM_TOKEN = "telegram-canary-must-not-pass";
    process.env.SSH_AUTH_SOCK = "/synthetic/agent.sock";
    const result = await executeBoundedProcess(spec(directory, "environment"));
    delete process.env.SYNTHETIC_PROVIDER_API_KEY;
    delete process.env.SYNTHETIC_TELEGRAM_TOKEN;
    delete process.env.SSH_AUTH_SOCK;
    expect(result.category).toBe("SUCCESS");
    if (result.category !== "SUCCESS") throw new Error("expected success");
    expect(JSON.parse(result.rawStdout.toString("utf8"))).toEqual(environment(directory));
  });

  it("uses only the fixed spec working directory", async () => {
    const directory = await temporaryDirectory();
    const result = await executeBoundedProcess(spec(directory, "cwd"));
    expect(result.category).toBe("SUCCESS");
    if (result.category !== "SUCCESS") throw new Error("expected success");
    expect(result.rawStdout.toString("utf8")).toBe(directory);
  });

  it("closes stdin and treats shell metacharacters only as argv data", async () => {
    const directory = await temporaryDirectory();
    const stdinResult = await executeBoundedProcess(spec(directory, "stdin-closed"));
    expect(stdinResult.category).toBe("SUCCESS");
    if (stdinResult.category !== "SUCCESS") throw new Error("expected success");
    expect(stdinResult.rawStdout.toString("utf8")).toBe("stdin-closed");

    const metacharacters = "$(touch should-not-exist); && | `uname`";
    const argvResult = await executeBoundedProcess(spec(directory, "success", [metacharacters]));
    expect(argvResult.category).toBe("SUCCESS");
    if (argvResult.category !== "SUCCESS") throw new Error("expected success");
    expect(argvResult.rawStdout.toString("utf8")).toBe(metacharacters);
    await expect(readFile(join(directory, "should-not-exist"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("terminates the full process group including descendants", async () => {
    const directory = await temporaryDirectory();
    const pidFile = join(directory, "child.pid");
    const result = await executeBoundedProcess(
      spec(directory, "tree", [pidFile], { timeoutMs: 300, terminationGraceMs: 100 }),
    );
    expect(result).toMatchObject({ category: "UNAVAILABLE", forcedKill: true });
    const childPid = Number(await readFile(pidFile, "utf8"));
    expect(await eventuallyProcessGone(childPid)).toBe(true);
  });

  it("still kills descendants when the direct parent exits on SIGTERM", async () => {
    const directory = await temporaryDirectory();
    const pidFile = join(directory, "descendant.pid");
    const result = await executeBoundedProcess(
      spec(directory, "tree-parent-exits", [pidFile], {
        timeoutMs: 300,
        terminationGraceMs: 100,
      }),
    );
    expect(result).toMatchObject({ category: "UNAVAILABLE", forcedKill: true });
    const childPid = Number(await readFile(pidFile, "utf8"));
    expect(await eventuallyProcessGone(childPid)).toBe(true);
  });
});

describe("registered command scheduler", () => {
  it("registers only the live-validated profile capability", async () => {
    const scheduler = new RegisteredCommandScheduler({
      maxConcurrent: 2,
      registeredCommandIds: LIVE_MONITORING_COMMAND_IDS,
    });
    expect(LIVE_MONITORING_COMMAND_IDS).toEqual(["HERMES_PROFILE_LIST"]);
    await expect(
      scheduler.submit("HERMES_CRON_STATUS" as never, async () => "deferred"),
    ).rejects.toThrow("not present in the frozen registry");
    await expect(
      scheduler.submit("HERMES_GATEWAY_STATUS" as never, async () => "retired"),
    ).rejects.toThrow("not present in the frozen registry");
  });

  it("rejects duplicate in-flight command IDs instead of creating an unbounded queue", async () => {
    const scheduler = new RegisteredCommandScheduler({
      maxConcurrent: 2,
      registeredCommandIds: LIVE_MONITORING_COMMAND_IDS,
    });
    let release: (() => void) | undefined;
    const first = scheduler.submit(
      "HERMES_PROFILE_LIST",
      () => new Promise<string>((resolve) => { release = () => resolve("done"); }),
    );
    await expect(scheduler.submit("HERMES_PROFILE_LIST", async () => "duplicate")).rejects.toBeInstanceOf(
      DuplicateCommandExecutionError,
    );
    release?.();
    await expect(first).resolves.toBe("done");
  });

  it("rejects IDs outside the frozen registry", async () => {
    const scheduler = new RegisteredCommandScheduler({
      maxConcurrent: 2,
      registeredCommandIds: LIVE_MONITORING_COMMAND_IDS,
    });
    await expect(
      scheduler.submit("ARBITRARY_COMMAND" as never, async () => "no"),
    ).rejects.toThrow();
  });
});
