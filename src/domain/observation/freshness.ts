export type Freshness = "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";

export interface FreshnessInput {
  readonly observedAt: string;
  readonly asOf: string;
  readonly staleAfterMs: number;
  readonly expiredAfterMs: number;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return parsed;
}

export function calculateFreshness(input: FreshnessInput): Freshness {
  if (
    !Number.isFinite(input.staleAfterMs) ||
    !Number.isFinite(input.expiredAfterMs) ||
    input.staleAfterMs < 0 ||
    input.expiredAfterMs < input.staleAfterMs
  ) {
    throw new Error("Freshness thresholds must satisfy 0 <= staleAfterMs <= expiredAfterMs.");
  }

  const ageMs = timestamp(input.asOf) - timestamp(input.observedAt);
  if (ageMs <= input.staleAfterMs) {
    return "FRESH";
  }
  if (ageMs > input.expiredAfterMs) {
    return "EXPIRED";
  }
  return "STALE";
}
