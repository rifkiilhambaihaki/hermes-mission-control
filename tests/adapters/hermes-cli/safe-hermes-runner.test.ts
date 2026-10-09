import { homedir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import type {
  BoundedProcessResult,
  BoundedProcessSpec,
  RunnerLogSink,
} from "../../../src/adapters/hermes-cli/runner/bounded-process-executor.js";
import {
  SafeHermesRunnerImplementation,
  buildFrozenProcessSpec,
} from "../../../src/adapters/hermes-cli/runner/safe-hermes-runner.js";
import {
  COMMAND_IDS,
  LIVE_MONITORING_COMMAND_IDS,
} from "../../../src/adapters/hermes-cli/runner/command-registry.js";

function successfulResult(commandId: BoundedProcessSpec["commandId"]): BoundedProcessResult {
  return {
    commandId,
    category: "SUCCESS",
    startTime: "2027-01-01T00:00:00.000Z",
    endTime: "2027-01-01T00:00:00.001Z",
    durationMs: 1,
    exitCode: 0,
    signal: null,
    stdoutBytes: 2,
    stderrBytes: 0,
    timedOut: false,
    outputLimitExceeded: false,
    forcedKill: false,
    errorCode: "NONE",
    rawStdout: Buffer.from("ok"),
    rawStderr: Buffer.alloc(0),
  };
}

describe("safe Hermes runner facade", () => {
  it("builds the only production process spec from the live-validated profile capability", () => {
    expect(buildFrozenProcessSpec("HERMES_PROFILE_LIST")).toMatchObject({
      executable: "hermes",
      argv: ["profile", "list"],
      workingDirectory: homedir(),
      timeoutMs: 3_000,
      stdoutLimitBytes: 128 * 1_024,
      stderrLimitBytes: 64 * 1_024,
      terminationGraceMs: 500,
    });
    expect(LIVE_MONITORING_COMMAND_IDS).toEqual(["HERMES_PROFILE_LIST"]);
  });

  it("refuses to build the historical CLI version capability for live monitoring", () => {
    expect(() => buildFrozenProcessSpec("HERMES_VERSION" as never)).toThrow(
      "not approved for live monitoring",
    );
  });

  it("refuses every retired, not-approved, and deferred capability before execution", async () => {
    const executor = vi.fn(async (spec: BoundedProcessSpec) => successfulResult(spec.commandId));
    const runner = new SafeHermesRunnerImplementation(executor) as unknown as {
      run(commandId: string): Promise<BoundedProcessResult>;
    };
    for (const commandId of COMMAND_IDS.filter((id) => id !== "HERMES_PROFILE_LIST")) {
      expect(() => buildFrozenProcessSpec(commandId as never)).toThrow(
        "not approved for live monitoring",
      );
      await expect(runner.run(commandId)).rejects.toThrow("not approved for live monitoring");
    }
    expect(executor).not.toHaveBeenCalled();
  });

  it("passes a static command through the internal executor without exposing argv input", async () => {
    const observed: BoundedProcessSpec[] = [];
    const executor = vi.fn(async (spec: BoundedProcessSpec, _sink?: RunnerLogSink) => {
      observed.push(spec);
      return successfulResult(spec.commandId);
    });
    const runner = new SafeHermesRunnerImplementation(executor);
    await expect(runner.run("HERMES_PROFILE_LIST")).resolves.toMatchObject({ category: "SUCCESS" });
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ executable: "hermes", argv: ["profile", "list"] });
  });

  it("keeps duplicate command execution bounded", async () => {
    let release: (() => void) | undefined;
    const executor = vi.fn(
      (spec: BoundedProcessSpec) =>
        new Promise<BoundedProcessResult>((resolve) => {
          release = () => resolve(successfulResult(spec.commandId));
        }),
    );
    const runner = new SafeHermesRunnerImplementation(executor);
    const first = runner.run("HERMES_PROFILE_LIST");
    await expect(runner.run("HERMES_PROFILE_LIST")).rejects.toThrow("already queued or running");
    release?.();
    await expect(first).resolves.toMatchObject({ category: "SUCCESS" });
  });
});
