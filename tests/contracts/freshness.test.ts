import { describe, expect, it } from "vitest";

import { calculateFreshness } from "../../src/domain/observation/freshness.js";

const observedAt = "2026-10-20T10:00:00+07:00";
const staleAfterMs = 60_000;
const expiredAfterMs = 120_000;

describe("freshness rules", () => {
  it("treats age <= stale_after as FRESH", () => {
    expect(
      calculateFreshness({
        observedAt,
        asOf: "2026-10-20T10:01:00+07:00",
        staleAfterMs,
        expiredAfterMs,
      }),
    ).toBe("FRESH");
  });

  it("treats stale_after < age <= expired_after as STALE", () => {
    expect(
      calculateFreshness({
        observedAt,
        asOf: "2026-10-20T10:01:00.001+07:00",
        staleAfterMs,
        expiredAfterMs,
      }),
    ).toBe("STALE");
    expect(
      calculateFreshness({
        observedAt,
        asOf: "2026-10-20T10:02:00+07:00",
        staleAfterMs,
        expiredAfterMs,
      }),
    ).toBe("STALE");
  });

  it("treats age > expired_after as EXPIRED", () => {
    expect(
      calculateFreshness({
        observedAt,
        asOf: "2026-10-20T10:02:00.001+07:00",
        staleAfterMs,
        expiredAfterMs,
      }),
    ).toBe("EXPIRED");
  });

  it("does not read a hidden global clock", () => {
    const input = { observedAt, asOf: observedAt, staleAfterMs, expiredAfterMs };
    expect(calculateFreshness(input)).toBe(calculateFreshness(input));
  });
});
