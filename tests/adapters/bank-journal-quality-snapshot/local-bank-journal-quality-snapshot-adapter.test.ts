import { constants } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { bankJournalFixtures } from "../../../fixtures/snapshots/bank-journal-quality.cases.js";
import {
  BankJournalQualitySnapshotDescriptor,
  LocalBankJournalQualitySnapshotAdapter,
} from "../../../src/adapters/bank-journal-quality-snapshot/index.js";

const roots: string[] = [];

async function secureRoot(): Promise<{ root: string; snapshot: string }> {
  const parent = await mkdtemp(resolve(tmpdir(), "bank-journal-quality-adapter-"));
  roots.push(parent);
  const root = resolve(parent, "snapshots");
  await mkdir(root, { mode: 0o700 });
  const snapshot = resolve(root, "bank_journal_quality.snapshot.json");
  return { root, snapshot };
}

function mvpFixture(): Record<string, unknown> {
  const fixture = structuredClone(bankJournalFixtures.unresolvedMapping) as Record<string, any>;
  fixture.generated_at = "2026-10-09T12:00:01+07:00";
  fixture.observed_at = "2026-10-09T12:00:00+07:00";
  fixture.reporting_period = {
    month: "2026-10", timezone: "Asia/Jakarta",
    starts_at: "2026-10-01T00:00:00+07:00", ends_at_exclusive: "2026-11-01T00:00:00+07:00",
  };
  fixture.data.summary = {
    quality_issue_count: 10, unresolved_mapping_count: 2, incomplete_evidence_count: 6,
    external_metadata_stale_count: 0, source_conflict_count: 2,
  };
  fixture.data.issue_details = { items: [], included_count: 0, total_count: 10, truncated: true };
  return fixture;
}

function adapter(path: string) {
  const descriptor = BankJournalQualitySnapshotDescriptor.fromApprovedServerConfiguration({
    snapshotPath: path,
    schemaRoot: resolve(import.meta.dirname, "../../../schemas"),
  });
  return new LocalBankJournalQualitySnapshotAdapter(descriptor);
}

async function observe(path: string, asOf = "2026-10-20T12:00:00+07:00") {
  return adapter(path).observe({
    source: "BANK_JOURNAL_QUALITY_LOCAL_SNAPSHOT",
    asOf,
    staleAfterMs: 30 * 24 * 60 * 60 * 1_000,
    expiredAfterMs: 120 * 24 * 60 * 60 * 1_000,
    futureToleranceMs: 5 * 60 * 1_000,
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("LocalBankJournalQualitySnapshotAdapter", () => {
  it("reads the fixed aggregate-only snapshot as PARTIAL with MEDIUM confidence", async () => {
    const { snapshot } = await secureRoot();
    await writeFile(snapshot, JSON.stringify(mvpFixture()), { mode: 0o600 });
    const result = await observe(snapshot);
    expect(result.availability).toBe("AVAILABLE");
    expect(result.freshness).toBe("FRESH");
    expect(result.completeness).toBe("PARTIAL");
    expect(result.confidence.level).toBe("MEDIUM");
    expect(result.reviewStatus).toBe("REVIEW_REQUIRED");
    expect(result.current?.summary).toEqual((mvpFixture() as any).data.summary);
    expect(result.error).toBeNull();
  });

  it("maps the independent 30/120-day freshness thresholds", async () => {
    const { snapshot } = await secureRoot();
    await writeFile(snapshot, JSON.stringify(mvpFixture()), { mode: 0o600 });
    expect((await observe(snapshot, "2026-11-08T12:00:00+07:00")).freshness).toBe("FRESH");
    expect((await observe(snapshot, "2026-11-08T12:00:01+07:00")).freshness).toBe("STALE");
    expect((await observe(snapshot, "2027-02-06T12:00:01+07:00")).freshness).toBe("EXPIRED");
  });

  it("rejects future snapshots beyond tolerance", async () => {
    const { snapshot } = await secureRoot();
    await writeFile(snapshot, JSON.stringify(mvpFixture()), { mode: 0o600 });
    await expect(observe(snapshot, "2026-10-09T11:54:59+07:00")).rejects.toThrow("BANK_JOURNAL_SNAPSHOT_INVALID");
  });

  it("rejects duplicate JSON keys and schema-invalid data", async () => {
    const { snapshot } = await secureRoot();
    await writeFile(snapshot, '{"schema_version":"1.0.0","schema_version":"1.0.0"}', { mode: 0o600 });
    await expect(observe(snapshot)).rejects.toThrow("BANK_JOURNAL_SNAPSHOT_INVALID");
    await writeFile(snapshot, JSON.stringify({ ...mvpFixture(), source: "SUBMISSION_TRACKER" }), { mode: 0o600 });
    await expect(observe(snapshot)).rejects.toThrow("BANK_JOURNAL_SNAPSHOT_INVALID");
  });

  it("rejects symlinks and insecure file or directory modes", async () => {
    const { root, snapshot } = await secureRoot();
    const real = resolve(root, "real.json");
    await writeFile(real, JSON.stringify(mvpFixture()), { mode: 0o600 });
    await symlink(real, snapshot);
    await expect(observe(snapshot)).rejects.toThrow("BANK_JOURNAL_SNAPSHOT_PATH_UNSAFE");
    await rm(snapshot);
    await writeFile(snapshot, JSON.stringify(mvpFixture()), { mode: 0o644 });
    await expect(observe(snapshot)).rejects.toThrow("BANK_JOURNAL_SNAPSHOT_INSECURE");
    await chmod(snapshot, 0o600);
    await chmod(root, 0o755);
    await expect(observe(snapshot)).rejects.toThrow("BANK_JOURNAL_SNAPSHOT_INSECURE");
  });

  it("enforces the bounded file size", async () => {
    const { snapshot } = await secureRoot();
    await writeFile(snapshot, "x".repeat(262_145), { mode: 0o600 });
    await expect(observe(snapshot)).rejects.toThrow("BANK_JOURNAL_SNAPSHOT_TOO_LARGE");
  });
});
