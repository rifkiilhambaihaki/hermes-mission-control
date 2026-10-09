import {
  STDERR_LIMIT_BYTES,
  STDOUT_LIMIT_BYTES,
  TIMEOUT_MILLISECONDS,
  FROZEN_COMMAND_REGISTRY,
  LIVE_MONITORING_COMMAND_IDS,
  resolveFrozenCommand,
  type HermesCommandId,
  type LiveMonitoringCommandId,
  type StaticLiveMonitoringCommandId,
} from "./command-registry.js";
import {
  executeBoundedProcess,
  type BoundedProcessResult,
  type BoundedProcessSpec,
  type RunnerLogSink,
} from "./bounded-process-executor.js";
import {
  FROZEN_PRODUCTION_PROCESS_CONFIG,
  buildFrozenHermesChildEnvironment,
} from "./child-environment.js";
import { RegisteredCommandScheduler } from "./registered-command-scheduler.js";

const TERMINATION_GRACE_MILLISECONDS = 500;

type ProcessExecutor = (
  spec: BoundedProcessSpec,
  logSink?: RunnerLogSink,
) => Promise<BoundedProcessResult>;

export interface SafeHermesRunner {
  run(commandId: StaticLiveMonitoringCommandId): Promise<BoundedProcessResult>;
}

export interface SafeHermesRunnerOptions {
  readonly logSink?: RunnerLogSink;
}

export function buildFrozenProcessSpec(
  commandId: LiveMonitoringCommandId,
): BoundedProcessSpec {
  const candidate = FROZEN_COMMAND_REGISTRY[commandId as HermesCommandId];
  if (candidate?.capabilityStatus !== "LIVE_VALIDATED") {
    throw new Error(`${commandId} is not approved for live monitoring.`);
  }
  const command = resolveFrozenCommand(commandId);
  return Object.freeze({
    commandId,
    executable: command.executable,
    argv: command.argv,
    workingDirectory: FROZEN_PRODUCTION_PROCESS_CONFIG.workingDirectory,
    environment: buildFrozenHermesChildEnvironment(),
    timeoutMs: TIMEOUT_MILLISECONDS[command.timeoutClass],
    stdoutLimitBytes: STDOUT_LIMIT_BYTES[command.stdoutClass],
    stderrLimitBytes: STDERR_LIMIT_BYTES,
    terminationGraceMs: TERMINATION_GRACE_MILLISECONDS,
  });
}

export class SafeHermesRunnerImplementation implements SafeHermesRunner {
  readonly #executor: ProcessExecutor;
  readonly #logSink: RunnerLogSink | undefined;
  readonly #scheduler = new RegisteredCommandScheduler({
    maxConcurrent: 2,
    registeredCommandIds: LIVE_MONITORING_COMMAND_IDS,
  });

  constructor(executor: ProcessExecutor, options: SafeHermesRunnerOptions = {}) {
    this.#executor = executor;
    this.#logSink = options.logSink;
  }

  async run(commandId: StaticLiveMonitoringCommandId): Promise<BoundedProcessResult> {
    return this.#schedule(commandId, buildFrozenProcessSpec(commandId));
  }


  async #schedule(
    commandId: LiveMonitoringCommandId,
    spec: BoundedProcessSpec,
  ): Promise<BoundedProcessResult> {
    return this.#scheduler.submit(commandId, () => this.#executor(spec, this.#logSink));
  }
}

export function createSafeHermesRunner(
  options: SafeHermesRunnerOptions = {},
): SafeHermesRunner {
  return new SafeHermesRunnerImplementation(executeBoundedProcess, options);
}
