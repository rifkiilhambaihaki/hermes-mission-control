import type { LiveMonitoringCommandId } from "./command-registry.js";

export class DuplicateCommandExecutionError extends Error {
  constructor(commandId: LiveMonitoringCommandId) {
    super(`Command ${commandId} is already queued or running.`);
    this.name = "DuplicateCommandExecutionError";
  }
}

interface QueuedTask<T> {
  readonly commandId: LiveMonitoringCommandId;
  readonly task: () => Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

export interface RegisteredCommandSchedulerOptions {
  readonly maxConcurrent: 2;
  readonly registeredCommandIds: readonly LiveMonitoringCommandId[];
}

export class RegisteredCommandScheduler {
  readonly #maxConcurrent: number;
  readonly #registeredIds: ReadonlySet<LiveMonitoringCommandId>;
  readonly #outstandingIds = new Set<LiveMonitoringCommandId>();
  readonly #queue: QueuedTask<unknown>[] = [];
  #active = 0;

  constructor(options: RegisteredCommandSchedulerOptions) {
    if (options.maxConcurrent !== 2) {
      throw new Error("Hermes process concurrency must remain frozen at two.");
    }
    this.#maxConcurrent = options.maxConcurrent;
    this.#registeredIds = new Set(options.registeredCommandIds);
  }

  async submit<T>(commandId: LiveMonitoringCommandId, task: () => Promise<T>): Promise<T> {
    if (!this.#registeredIds.has(commandId)) {
      throw new Error("Command ID is not present in the frozen registry.");
    }
    if (this.#outstandingIds.has(commandId)) {
      throw new DuplicateCommandExecutionError(commandId);
    }
    if (this.#outstandingIds.size >= this.#registeredIds.size) {
      throw new Error("Registered command queue is full.");
    }

    this.#outstandingIds.add(commandId);
    return new Promise<T>((resolve, reject) => {
      this.#queue.push({ commandId, task, resolve, reject } as QueuedTask<unknown>);
      this.#drain();
    });
  }

  #drain(): void {
    while (this.#active < this.#maxConcurrent) {
      const queued = this.#queue.shift();
      if (queued === undefined) return;
      this.#active += 1;
      void queued
        .task()
        .then(queued.resolve, queued.reject)
        .finally(() => {
          this.#active -= 1;
          this.#outstandingIds.delete(queued.commandId);
          this.#drain();
        });
    }
  }
}
