export const AUTH_FAILURE_POLICY = Object.freeze({
  maxFailures: 5,
  windowMs: 5 * 60 * 1_000,
  maximumDelayMs: 30_000,
});

export interface AuthFailureLimiterOptions {
  readonly clock: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

export interface AuthFailureOutcome {
  readonly blocked: boolean;
  readonly failureCount: number;
  readonly retryAfterSeconds: number;
}

export class AuthFailureLimiter {
  readonly #clock: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #failures: number[] = [];

  constructor(options: AuthFailureLimiterOptions) {
    this.#clock = options.clock;
    this.#sleep = options.sleep;
  }

  static delayForFailureCount(failureCount: number): number {
    if (failureCount <= 3) {
      return 0;
    }
    return Math.min(2 ** (failureCount - 4) * 1_000, AUTH_FAILURE_POLICY.maximumDelayMs);
  }

  #prune(now: number): void {
    const earliestAllowed = now - AUTH_FAILURE_POLICY.windowMs;
    while (this.#failures.length > 0 && this.#failures[0]! <= earliestAllowed) {
      this.#failures.shift();
    }
  }

  check(): { readonly blocked: boolean; readonly retryAfterSeconds: number } {
    const now = this.#clock();
    this.#prune(now);
    if (this.#failures.length < AUTH_FAILURE_POLICY.maxFailures) {
      return { blocked: false, retryAfterSeconds: 0 };
    }
    const retryAt = this.#failures[0]! + AUTH_FAILURE_POLICY.windowMs;
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1_000)),
    };
  }

  async recordFailure(): Promise<AuthFailureOutcome> {
    const now = this.#clock();
    this.#prune(now);
    if (this.#failures.length === AUTH_FAILURE_POLICY.maxFailures) {
      this.#failures.shift();
    }
    this.#failures.push(now);
    const failureCount = this.#failures.length;
    const delay = AuthFailureLimiter.delayForFailureCount(failureCount);
    if (delay > 0) {
      await this.#sleep(delay);
    }
    const state = this.check();
    return { ...state, failureCount };
  }

  recordSuccess(): void {
    this.#failures.length = 0;
  }

  retainedFailureCount(): number {
    this.#prune(this.#clock());
    return this.#failures.length;
  }
}
