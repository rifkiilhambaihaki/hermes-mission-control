import { constants } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LocalSubmissionTrackerSnapshotAdapter,
  SubmissionTrackerSnapshotDescriptor,
} from "../../../src/adapters/submission-tracker-snapshot/local-submission-tracker-snapshot-adapter.js";
import { submissionFixtures } from "../../../fixtures/snapshots/submission-tracker.cases.js";

const projectRoot = resolve(import.meta.dirname, "../../..");
const temporaryRoots: string[] = [];

function mvpFixture(): Record<string, unknown> {
  const snapshot = structuredClone(submissionFixtures.activeSubmission) as {
    data: { paper_details: { items: unknown[]; included_count: number; total_count: number; truncated: boolean } };
  } & Record<string, unknown>;
  snapshot.data.paper_details = { items: [], included_count: 0, total_count: 1, truncated: true };
  return snapshot;
}

async function fixtureFile(snapshot: unknown = mvpFixture()): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "mission-control-submission-"));
  temporaryRoots.push(root);
  await chmod(root, 0o700);
  const directory = resolve(root, "snapshots");
  await mkdir(directory, { mode: 0o700 });
  const path = resolve(directory, "submission_tracker.snapshot.json");
  await writeFile(path, `${JSON.stringify(snapshot)}\n`, {
    mode: 0o600,
    flag: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
  });
  return path;
}

function adapter(path: string): LocalSubmissionTrackerSnapshotAdapter {
  return new LocalSubmissionTrackerSnapshotAdapter(
    SubmissionTrackerSnapshotDescriptor.fromApprovedServerConfiguration({
      snapshotPath: path,
      schemaRoot: resolve(projectRoot, "schemas"),
    }),
  );
}

async function observe(path: string, asOf = "2026-10-20T10:00:00+07:00") {
  return adapter(path).observe({
    source: "SUBMISSION_TRACKER_LOCAL_SNAPSHOT",
    asOf,
    staleAfterMs: 7 * 24 * 60 * 60 * 1_000,
    expiredAfterMs: 30 * 24 * 60 * 60 * 1_000,
    futureToleranceMs: 5 * 60 * 1_000,
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })));
});

describe("fixed Submission Tracker snapshot adapter", () => {
  it("validates aggregate-only snapshots as AVAILABLE/PARTIAL with MEDIUM confidence", async () => {
    const observation = await observe(await fixtureFile());
    expect(observation).toMatchObject({
      availability: "AVAILABLE",
      reviewStatus: "NONE",
      completeness: "PARTIAL",
      freshness: "FRESH",
      confidence: { level: "MEDIUM" },
      current: { summary: { total_count: 1, active_count: 1 } },
      error: null,
    });
    expect(observation.confidence.reasons.join(" ")).toContain("paper detail export disabled");
  });

  it("derives freshness at the approved seven-day and thirty-day boundaries", async () => {
    const snapshot = mvpFixture();
    snapshot.observed_at = "2026-10-20T08:00:00+07:00";
    snapshot.generated_at = "2026-10-20T08:00:01+07:00";
    const path = await fixtureFile(snapshot);
    expect((await observe(path, "2026-10-27T08:00:00+07:00")).freshness).toBe("FRESH");
    expect((await observe(path, "2026-10-27T08:00:00.001+07:00")).freshness).toBe("STALE");
    expect((await observe(path, "2026-11-19T08:00:00+07:00")).freshness).toBe("STALE");
    expect((await observe(path, "2026-11-19T08:00:00.001+07:00")).freshness).toBe("EXPIRED");
  });

  it.each([
    ["schema-invalid", { ...mvpFixture(), secret: "FAKE_TOKEN_CANARY" }],
    ["semantic-invalid", { ...mvpFixture(), generated_at: "2026-10-19T08:00:00+07:00" }],
  ])("fails closed for %s content without exposing canaries", async (_name, snapshot) => {
    await expect(observe(await fixtureFile(snapshot))).rejects.toThrow("SUBMISSION_SNAPSHOT_INVALID");
  });

  it("rejects duplicate JSON keys, oversized files, permissive modes, and symlinks", async () => {
    const duplicatePath = await fixtureFile();
    await writeFile(duplicatePath, '{"schema_version":"1.0.0","schema_version":"1.0.0"}\n', { mode: 0o600 });
    await expect(observe(duplicatePath)).rejects.toThrow("SUBMISSION_SNAPSHOT_INVALID");

    const oversizedPath = await fixtureFile();
    await writeFile(oversizedPath, "x".repeat(262_145), { mode: 0o600 });
    await expect(observe(oversizedPath)).rejects.toThrow("SUBMISSION_SNAPSHOT_TOO_LARGE");

    const permissivePath = await fixtureFile();
    await chmod(permissivePath, 0o640);
    await expect(observe(permissivePath)).rejects.toThrow("SUBMISSION_SNAPSHOT_INSECURE");

    const realPath = await fixtureFile();
    const linkRoot = await mkdtemp(resolve(tmpdir(), "mission-control-submission-link-"));
    temporaryRoots.push(linkRoot);
    await chmod(linkRoot, 0o700);
    const linkDirectory = resolve(linkRoot, "snapshots");
    await mkdir(linkDirectory, { mode: 0o700 });
    const linkPath = resolve(linkDirectory, "submission_tracker.snapshot.json");
    await symlink(realPath, linkPath);
    await expect(observe(linkPath)).rejects.toThrow("SUBMISSION_SNAPSHOT_PATH_UNSAFE");
  });

  it("retains only the aggregate and structural truncated window", async () => {
    const observation = await observe(await fixtureFile());
    expect(observation.current?.paper_details).toEqual({ items: [], included_count: 0, total_count: 1, truncated: true });
    expect(JSON.stringify(observation.current)).not.toContain("paper_ref");
  });
});
