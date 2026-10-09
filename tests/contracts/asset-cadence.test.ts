import { describe, expect, it } from "vitest";

import { evaluateAssetCadence, isCapturedLate } from "../../src/domain/accounting/asset-cadence.js";

const base = {
  period: "2026-10",
  reportingPeriod: "2026-10",
  dueAt: "2026-10-15T00:00:00+07:00",
  graceUntil: "2026-10-20T00:00:00+07:00",
  capturedAt: null,
  asOf: "2026-10-10T00:00:00+07:00",
  snapshotStatus: "AVAILABLE",
} as const;

describe("asset snapshot cadence", () => {
  it("uses frozen deterministic precedence", () => {
    expect(evaluateAssetCadence(base)).toBe("CURRENT_PERIOD_NOT_DUE");
    expect(evaluateAssetCadence({ ...base, asOf: base.dueAt })).toBe("CURRENT_PERIOD_DUE");
    expect(evaluateAssetCadence({ ...base, asOf: base.graceUntil })).toBe("CURRENT_PERIOD_DUE");
    expect(evaluateAssetCadence({ ...base, asOf: "2026-10-20T00:00:01+07:00" })).toBe("OVERDUE");
    expect(evaluateAssetCadence({ ...base, capturedAt: "2026-10-12T00:00:00+07:00" })).toBe(
      "CURRENT_PERIOD_CAPTURED",
    );
    expect(evaluateAssetCadence({ ...base, snapshotStatus: "UNKNOWN" })).toBe("UNKNOWN");
  });

  it("does not map a historical period to current-period MISSING", () => {
    expect(evaluateAssetCadence({ ...base, period: "2026-09" })).toBe("UNKNOWN");
    expect(evaluateAssetCadence({ ...base, period: "2026-10", asOf: base.dueAt })).toBe(
      "CURRENT_PERIOD_DUE",
    );
  });

  it("derives captured-late without guessing a closing date", () => {
    expect(isCapturedLate("2026-10-20T00:00:00+07:00", base.graceUntil)).toBe(false);
    expect(isCapturedLate("2026-10-20T00:00:01+07:00", base.graceUntil)).toBe(true);
    expect(isCapturedLate(null, base.graceUntil)).toBe(false);
  });
});
