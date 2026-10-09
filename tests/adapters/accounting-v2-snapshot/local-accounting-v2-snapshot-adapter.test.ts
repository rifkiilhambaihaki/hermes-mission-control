import { constants } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AccountingSnapshotDescriptor,
  LocalAccountingV2SnapshotAdapter,
} from "../../../src/adapters/accounting-v2-snapshot/local-accounting-v2-snapshot-adapter.js";
import { accountingFixtures } from "../../../fixtures/snapshots/accounting-v2.cases.js";

const projectRoot = resolve(import.meta.dirname, "../../..");
const temporaryRoots: string[] = [];

async function fixtureFile(snapshot: unknown = accountingFixtures.validNormal): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "mission-control-accounting-"));
  temporaryRoots.push(root);
  await chmod(root, 0o700);
  const directory = resolve(root, "snapshots");
  await mkdir(directory, { mode: 0o700 });
  const path = resolve(directory, "accounting_v2.snapshot.json");
  await writeFile(path, `${JSON.stringify(snapshot)}\n`, { mode: 0o600, flag: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY });
  return path;
}

function mvpFixture(): Record<string, unknown> {
  const snapshot = structuredClone(accountingFixtures.validNormal) as {
    data: {
      thresholds: unknown[];
      category_details: {
        items: unknown[];
        included_count: number;
        total_count: number;
        truncated: boolean;
      };
    };
  } & Record<string, unknown>;
  snapshot.data.thresholds = [];
  snapshot.data.category_details = {
    items: [],
    included_count: 0,
    total_count: 0,
    truncated: false,
  };
  return snapshot;
}

function adapter(path: string): LocalAccountingV2SnapshotAdapter {
  return new LocalAccountingV2SnapshotAdapter(
    AccountingSnapshotDescriptor.fromApprovedServerConfiguration({
      snapshotPath: path,
      schemaRoot: resolve(projectRoot, "schemas"),
    }),
  );
}

async function observe(path: string, asOf = "2026-10-20T10:00:00+07:00") {
  return adapter(path).observe({
    source: "ACCOUNTING_V2_LOCAL_SNAPSHOT",
    asOf,
    staleAfterMs: 24 * 60 * 60 * 1_000,
    expiredAfterMs: 72 * 60 * 60 * 1_000,
    futureToleranceMs: 5 * 60 * 1_000,
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })));
});

describe("fixed Accounting V2 snapshot adapter", () => {
  it("validates the canonical snapshot and exposes aggregate data with PARTIAL completeness", async () => {
    const observation = await observe(await fixtureFile(mvpFixture()));
    expect(observation).toMatchObject({
      availability: "AVAILABLE",
      reviewStatus: "NONE",
      completeness: "PARTIAL",
      freshness: "FRESH",
      current: {
        summary: {
          income_idr: 1_000_000,
          transaction_count: 2,
        },
      },
      error: null,
    });
    expect(observation.confidence.reasons.join(" ")).toContain("detail export disabled");
  });

  it("derives freshness at the approved 24h and 72h boundaries", async () => {
    const snapshot = structuredClone(accountingFixtures.validNormal) as Record<string, unknown>;
    snapshot.observed_at = "2026-10-20T08:00:00+07:00";
    snapshot.generated_at = "2026-10-20T08:00:01+07:00";
    const path = await fixtureFile(snapshot);
    expect((await observe(path, "2026-10-21T08:00:00+07:00")).freshness).toBe("FRESH");
    expect((await observe(path, "2026-10-21T08:00:00.001+07:00")).freshness).toBe("STALE");
    expect((await observe(path, "2026-10-23T08:00:00+07:00")).freshness).toBe("STALE");
    expect((await observe(path, "2026-10-23T08:00:00.001+07:00")).freshness).toBe("EXPIRED");
  });

  const validFixture = accountingFixtures.validNormal as Record<string, unknown>;
  it.each([
    ["schema-invalid", { ...validFixture, secret: "FAKE_TOKEN_CANARY" }],
    ["semantic-invalid", { ...validFixture, generated_at: "2026-10-19T08:00:00+07:00" }],
  ])("fails closed for %s content without exposing canaries", async (_name, snapshot) => {
    await expect(observe(await fixtureFile(snapshot))).rejects.toThrow("ACCOUNTING_SNAPSHOT_INVALID");
  });

  it("rejects duplicate JSON keys, oversized files, permissive modes, and symlinks", async () => {
    const duplicatePath = await fixtureFile();
    await writeFile(duplicatePath, '{"schema_version":"1.0.0","schema_version":"1.0.0"}\n', { mode: 0o600 });
    await expect(observe(duplicatePath)).rejects.toThrow("ACCOUNTING_SNAPSHOT_INVALID");

    const oversizedPath = await fixtureFile();
    await writeFile(oversizedPath, "x".repeat(262_145), { mode: 0o600 });
    await expect(observe(oversizedPath)).rejects.toThrow("ACCOUNTING_SNAPSHOT_TOO_LARGE");

    const permissivePath = await fixtureFile();
    await chmod(permissivePath, 0o640);
    await expect(observe(permissivePath)).rejects.toThrow("ACCOUNTING_SNAPSHOT_INSECURE");

    const realPath = await fixtureFile();
    const linkRoot = await mkdtemp(resolve(tmpdir(), "mission-control-accounting-link-"));
    temporaryRoots.push(linkRoot);
    await chmod(linkRoot, 0o700);
    const linkDirectory = resolve(linkRoot, "snapshots");
    await mkdir(linkDirectory, { mode: 0o700 });
    const linkPath = resolve(linkDirectory, "accounting_v2.snapshot.json");
    await symlink(realPath, linkPath);
    await expect(observe(linkPath)).rejects.toThrow("ACCOUNTING_SNAPSHOT_PATH_UNSAFE");
  });

  it("retains explicit MVP placeholders while marking the observation PARTIAL", async () => {
    const observation = await observe(await fixtureFile(mvpFixture()));
    const serialized = JSON.stringify(observation.current);
    expect(observation.completeness).toBe("PARTIAL");
    expect(serialized).toContain('"summary"');
    expect(serialized).toContain('"category_details"');
    expect(serialized).toContain('"thresholds"');
  });
});
