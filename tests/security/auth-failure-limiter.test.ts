import { describe, expect, it } from "vitest";

import { AuthFailureLimiter } from "../../src/security/auth-failure-limiter.js";

function fixture() {
  let now = 1_800_000_000_000;
  const delays: number[] = [];
  const limiter = new AuthFailureLimiter({
    clock: () => now,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });
  return {
    advance(milliseconds: number) {
      now += milliseconds;
    },
    delays,
    limiter,
  };
}

describe("bounded global authentication-failure limiter", () => {
  it("counts failures, applies progressive delay after the third, and blocks at five", async () => {
    const { delays, limiter } = fixture();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const outcome = await limiter.recordFailure();
      expect(outcome.failureCount).toBe(attempt);
      expect(outcome.blocked).toBe(false);
    }
    const fifth = await limiter.recordFailure();
    expect(fifth.failureCount).toBe(5);
    expect(fifth.blocked).toBe(true);
    expect(fifth.retryAfterSeconds).toBeGreaterThan(0);
    expect(delays).toEqual([1_000, 2_000]);
    expect(limiter.retainedFailureCount()).toBeLessThanOrEqual(5);
  });

  it("caps progressive delay at 30 seconds", () => {
    expect(AuthFailureLimiter.delayForFailureCount(3)).toBe(0);
    expect(AuthFailureLimiter.delayForFailureCount(4)).toBe(1_000);
    expect(AuthFailureLimiter.delayForFailureCount(20)).toBe(30_000);
  });

  it("resets failures after successful authentication", async () => {
    const { limiter } = fixture();
    await limiter.recordFailure();
    await limiter.recordFailure();
    limiter.recordSuccess();
    expect(limiter.retainedFailureCount()).toBe(0);
    expect(limiter.check().blocked).toBe(false);
  });

  it("has no permanent lockout and uses an injected fake clock", async () => {
    const { advance, limiter } = fixture();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await limiter.recordFailure();
    }
    expect(limiter.check().blocked).toBe(true);
    advance(5 * 60 * 1_000 + 1);
    expect(limiter.check()).toEqual({ blocked: false, retryAfterSeconds: 0 });
    expect(limiter.retainedFailureCount()).toBe(0);
  });
});
