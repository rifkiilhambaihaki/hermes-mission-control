import { spawn, type ChildProcess } from "node:child_process";

import type { HermesCommandId } from "./command-registry.js";

export type ProcessExitCategory = "SUCCESS" | "UNAVAILABLE" | "UNKNOWN";
export type SanitizedRunnerErrorCode =
  | "NONE"
  | "TIMEOUT"
  | "STDOUT_LIMIT_EXCEEDED"
  | "STDERR_LIMIT_EXCEEDED"
  | "EXECUTABLE_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "SPAWN_FAILED"
  | "NONZERO_EXIT"
  | "PROCESS_SIGNALLED";

export interface BoundedProcessSpec {
  readonly commandId: HermesCommandId;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly workingDirectory: string;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly timeoutMs: number;
  readonly stdoutLimitBytes: number;
  readonly stderrLimitBytes: number;
  readonly terminationGraceMs: number;
}

interface ProcessResultBase {
  readonly commandId: HermesCommandId;
  readonly category: ProcessExitCategory;
  readonly startTime: string;
  readonly endTime: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly timedOut: boolean;
  readonly outputLimitExceeded: boolean;
  readonly forcedKill: boolean;
  readonly errorCode: SanitizedRunnerErrorCode;
}

export interface SuccessfulProcessResult extends ProcessResultBase {
  readonly category: "SUCCESS";
  readonly errorCode: "NONE";
  readonly rawStdout: Buffer;
  readonly rawStderr: Buffer;
}

export interface FailedProcessResult extends ProcessResultBase {
  readonly category: "UNAVAILABLE" | "UNKNOWN";
}

export type BoundedProcessResult = SuccessfulProcessResult | FailedProcessResult;

export type RunnerLogEntry =
  | {
      readonly phase: "START";
      readonly commandId: HermesCommandId;
      readonly startTime: string;
    }
  | {
      readonly phase: "END";
      readonly commandId: HermesCommandId;
      readonly startTime: string;
      readonly endTime: string;
      readonly durationMs: number;
      readonly category: ProcessExitCategory;
      readonly stdoutBytes: number;
      readonly stderrBytes: number;
      readonly timedOut: boolean;
      readonly outputLimitExceeded: boolean;
      readonly forcedKill: boolean;
      readonly errorCode: SanitizedRunnerErrorCode;
    };

export type RunnerLogSink = (entry: RunnerLogEntry) => void;

function safeLog(sink: RunnerLogSink | undefined, entry: RunnerLogEntry): void {
  try {
    sink?.(entry);
  } catch {
    // Observability must not influence process lifecycle or expose hidden data.
  }
}

function sanitizedSpawnError(error: unknown): SanitizedRunnerErrorCode {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return "EXECUTABLE_NOT_FOUND";
  if (code === "EACCES" || code === "EPERM") return "PERMISSION_DENIED";
  return "SPAWN_FAILED";
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      try {
        child.kill(signal);
      } catch {
        // The child may have exited between the group and direct signal attempts.
      }
    }
  }
}

function processGroupExists(child: ChildProcess): boolean {
  if (child.pid === undefined) return false;
  if (process.platform === "win32") return child.exitCode === null && child.signalCode === null;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function validateSpec(spec: BoundedProcessSpec): void {
  if (!Number.isSafeInteger(spec.timeoutMs) || spec.timeoutMs <= 0) {
    throw new Error("Process timeout must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(spec.stdoutLimitBytes) || spec.stdoutLimitBytes <= 0) {
    throw new Error("stdout limit must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(spec.stderrLimitBytes) || spec.stderrLimitBytes <= 0) {
    throw new Error("stderr limit must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(spec.terminationGraceMs) || spec.terminationGraceMs < 0) {
    throw new Error("Termination grace must be a nonnegative safe integer.");
  }
}

export async function executeBoundedProcess(
  spec: BoundedProcessSpec,
  logSink?: RunnerLogSink,
): Promise<BoundedProcessResult> {
  validateSpec(spec);
  const startedAtMs = Date.now();
  const startTime = new Date(startedAtMs).toISOString();
  safeLog(logSink, { phase: "START", commandId: spec.commandId, startTime });

  return new Promise<BoundedProcessResult>((resolve) => {
    let child: ChildProcess;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    let forcedKill = false;
    let terminating = false;
    let settled = false;
    let spawnError: SanitizedRunnerErrorCode | undefined;
    let terminationError: SanitizedRunnerErrorCode | undefined;
    let pendingClose:
      | { readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }
      | undefined;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timeoutHandle: NodeJS.Timeout | undefined;
    let escalationHandle: NodeJS.Timeout | undefined;

    const finish = (
      category: ProcessExitCategory,
      errorCode: SanitizedRunnerErrorCode,
      exitCode: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      if (escalationHandle !== undefined) clearTimeout(escalationHandle);
      const endedAtMs = Date.now();
      const endTime = new Date(endedAtMs).toISOString();
      const base = {
        commandId: spec.commandId,
        category,
        startTime,
        endTime,
        durationMs: Math.max(0, endedAtMs - startedAtMs),
        exitCode,
        signal,
        stdoutBytes,
        stderrBytes,
        timedOut,
        outputLimitExceeded,
        forcedKill,
        errorCode,
      } as const;
      safeLog(logSink, {
        phase: "END",
        commandId: spec.commandId,
        startTime,
        endTime,
        durationMs: base.durationMs,
        category,
        stdoutBytes,
        stderrBytes,
        timedOut,
        outputLimitExceeded,
        forcedKill,
        errorCode,
      });
      if (category === "SUCCESS") {
        resolve({
          ...base,
          category: "SUCCESS",
          errorCode: "NONE",
          rawStdout: Buffer.concat(stdoutChunks),
          rawStderr: Buffer.concat(stderrChunks),
        });
      } else {
        resolve({ ...base, category, errorCode } as FailedProcessResult);
      }
    };

    const completeClosedProcess = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      if (
        terminationError === "STDOUT_LIMIT_EXCEEDED" ||
        terminationError === "STDERR_LIMIT_EXCEEDED"
      ) {
        finish("UNKNOWN", terminationError, exitCode, signal);
        return;
      }
      if (terminationError === "TIMEOUT") {
        finish("UNAVAILABLE", "TIMEOUT", exitCode, signal);
        return;
      }
      if (spawnError !== undefined) {
        finish("UNAVAILABLE", spawnError, exitCode, signal);
        return;
      }
      if (exitCode === 0) {
        finish("SUCCESS", "NONE", exitCode, signal);
        return;
      }
      finish(
        "UNAVAILABLE",
        signal === null ? "NONZERO_EXIT" : "PROCESS_SIGNALLED",
        exitCode,
        signal,
      );
    };

    const beginTermination = (reason: SanitizedRunnerErrorCode) => {
      if (terminating || settled) return;
      terminating = true;
      terminationError = reason;
      signalProcessGroup(child, "SIGTERM");
      escalationHandle = setTimeout(() => {
        if (settled) return;
        if (processGroupExists(child)) {
          forcedKill = true;
          signalProcessGroup(child, "SIGKILL");
        }
        if (pendingClose !== undefined) {
          completeClosedProcess(pendingClose.exitCode, pendingClose.signal);
        }
      }, spec.terminationGraceMs);
    };

    try {
      child = spawn(spec.executable, [...spec.argv], {
        cwd: spec.workingDirectory,
        env: { ...spec.environment },
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      finish("UNAVAILABLE", sanitizedSpawnError(error), null, null);
      return;
    }

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += buffer.length;
      if (stdoutBytes > spec.stdoutLimitBytes) {
        outputLimitExceeded = true;
        stdoutChunks.length = 0;
        stderrChunks.length = 0;
        child.stdout?.destroy();
        child.stderr?.destroy();
        beginTermination("STDOUT_LIMIT_EXCEEDED");
        return;
      }
      if (!terminating) stdoutChunks.push(buffer);
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += buffer.length;
      if (stderrBytes > spec.stderrLimitBytes) {
        outputLimitExceeded = true;
        stdoutChunks.length = 0;
        stderrChunks.length = 0;
        child.stdout?.destroy();
        child.stderr?.destroy();
        beginTermination("STDERR_LIMIT_EXCEEDED");
        return;
      }
      if (!terminating) stderrChunks.push(buffer);
    });

    child.once("error", (error) => {
      spawnError = sanitizedSpawnError(error);
    });

    child.once("close", (exitCode, signal) => {
      pendingClose = { exitCode, signal };
      if (terminating && !forcedKill && processGroupExists(child)) return;
      completeClosedProcess(exitCode, signal);
    });

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      stdoutChunks.length = 0;
      stderrChunks.length = 0;
      beginTermination("TIMEOUT");
    }, spec.timeoutMs);
  });
}
