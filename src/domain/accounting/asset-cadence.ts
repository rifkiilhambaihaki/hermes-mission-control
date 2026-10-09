import type { AssetCadenceState, SnapshotStatus } from "../contracts/snapshot-types.js";

export interface AssetCadenceInput {
  readonly period: string;
  readonly reportingPeriod: string;
  readonly dueAt: string;
  readonly graceUntil: string;
  readonly capturedAt: string | null;
  readonly asOf: string;
  readonly snapshotStatus: SnapshotStatus;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return parsed;
}

export function evaluateAssetCadence(input: AssetCadenceInput): AssetCadenceState {
  if (input.snapshotStatus === "UNKNOWN") {
    return "UNKNOWN";
  }

  if (input.period !== input.reportingPeriod) {
    return "UNKNOWN";
  }

  if (input.capturedAt !== null) {
    return "CURRENT_PERIOD_CAPTURED";
  }

  const asOf = timestamp(input.asOf);
  const dueAt = timestamp(input.dueAt);
  const graceUntil = timestamp(input.graceUntil);

  if (asOf < dueAt) {
    return "CURRENT_PERIOD_NOT_DUE";
  }
  if (asOf <= graceUntil) {
    return "CURRENT_PERIOD_DUE";
  }
  return "OVERDUE";
}

export function isCapturedLate(capturedAt: string | null, graceUntil: string): boolean {
  return capturedAt !== null && timestamp(capturedAt) > timestamp(graceUntil);
}
