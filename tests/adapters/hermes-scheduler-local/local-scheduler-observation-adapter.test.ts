import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  SCHEDULER_MAX_JOB_COUNT,
  SCHEDULER_REGISTRY_MAX_BYTES,
  LocalSchedulerObservationAdapter,
  SchedulerObservationDescriptor,
} from "../../../src/adapters/hermes-scheduler-local/index.js";
import { mapSchedulerRegistrySnapshot } from "../../../src/adapters/hermes-scheduler-local/local-scheduler-observation-adapter.js";

const roots: string[] = [];
const fixedTime = "2027-01-01T00:00:00.000Z";
const request = {
  source: "HERMES_SCHEDULER_LOCAL" as const,
  observedAt: fixedTime,
  fetchedAt: fixedTime,
  asOf: fixedTime,
  staleAfterMs: 30_000,
  expiredAfterMs: 60_000,
};

function job(id: string, enabled?: boolean): Record<string, unknown> {
  return {
    id,
    ...(enabled === undefined ? {} : { enabled }),
    prompt: `PROMPT-PRIVACY-CANARY-${id}`,
    deliver: `telegram:CHAT-ID-CANARY-${id}`,
    origin: { user_id: `USER-ID-CANARY-${id}` },
    arbitrary_payload: { token: `TOKEN-CANARY-${id}` },
    workdir: `/private/path/${id}`,
  };
}

async function fixture(registry: unknown | string | null = { jobs: [] }) {
  const root = await mkdtemp(resolve(tmpdir(), "mission-control-scheduler-observation-"));
  roots.push(root);
  const profileRoot = resolve(root, "approved-profile");
  const cronRoot = resolve(profileRoot, "cron");
  const registryPath = resolve(cronRoot, "jobs.json");
  await mkdir(profileRoot, { recursive: true });
  if (registry !== null) {
    await mkdir(cronRoot, { recursive: true });
    await writeFile(
      registryPath,
      typeof registry === "string" ? registry : JSON.stringify(registry),
      "utf8",
    );
  }
  const descriptor = SchedulerObservationDescriptor.fromApprovedServerConfiguration({ profileRoot });
  return {
    root,
    profileRoot,
    cronRoot,
    registryPath,
    adapter: new LocalSchedulerObservationAdapter(descriptor),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("LocalSchedulerObservationAdapter", () => {
  it("projects only authoritative counts from a valid mixed registry", async () => {
    const { adapter } = await fixture({
      jobs: [job("enabled-job", true), job("disabled-job", false), job("legacy-enabled-job")],
      updated_at: "2026-12-31T23:59:59.000Z",
    });
    const observation = await adapter.observe(request);
    expect(observation).toMatchObject({
      availability: "AVAILABLE",
      reviewStatus: "NONE",
      completeness: "COMPLETE",
      freshness: "FRESH",
      confidence: { level: "HIGH" },
      current: {
        schedulerAvailability: "AVAILABLE",
        enabledJobCount: 2,
        totalJobCount: 3,
      },
      error: null,
      lastKnownGood: null,
    });
    expect(JSON.stringify(observation)).not.toMatch(
      /PROMPT-PRIVACY|CHAT-ID|USER-ID|TOKEN-CANARY|private\/path|enabled-job|disabled-job/,
    );
  });

  it("maps a canonical empty registry to EMPTY rather than zero-valued AVAILABLE", async () => {
    const { adapter } = await fixture({ jobs: [], updated_at: fixedTime });
    await expect(adapter.observe(request)).resolves.toMatchObject({
      availability: "EMPTY",
      reviewStatus: "NONE",
      completeness: "EMPTY",
      freshness: "FRESH",
      current: {
        schedulerAvailability: "EMPTY",
        enabledJobCount: 0,
        totalJobCount: 0,
      },
      error: null,
    });
  });

  it.each([
    ["all enabled", [job("a", true), job("b", true)], 2],
    ["all disabled", [job("a", false), job("b", false)], 0],
    ["mixed", [job("a", true), job("b", false)], 1],
    ["legacy missing enabled defaults true upstream", [job("a"), job("b", false)], 1],
  ])("counts $0 records according to upstream enabled semantics", async (_label, jobs, enabled) => {
    const { adapter } = await fixture({ jobs });
    await expect(adapter.observe(request)).resolves.toMatchObject({
      availability: "AVAILABLE",
      current: { totalJobCount: 2, enabledJobCount: enabled },
    });
  });

  it("maps a missing registry to authoritative EMPTY without creating cron state", async () => {
    const { adapter, cronRoot, registryPath } = await fixture(null);
    await expect(adapter.observe(request)).resolves.toMatchObject({
      availability: "EMPTY",
      reviewStatus: "NONE",
      current: {
        schedulerAvailability: "EMPTY",
        totalJobCount: 0,
        enabledJobCount: 0,
      },
    });
    await expect(lstat(cronRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(registryPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["malformed JSON", '{"jobs":['],
    ["duplicate JSON key", '{"jobs":[],"jobs":[]}'],
    ["bare list auto-repair shape", "[]"],
    ["missing jobs field", { updated_at: fixedTime }],
    ["unknown top-level field", { jobs: [], canary: "FAILURE-PRIVACY-CANARY" }],
    ["invalid updated_at", { jobs: [], updated_at: 123 }],
    ["non-object job", { jobs: ["job"] }],
    ["missing job id", { jobs: [{ enabled: true, prompt: "FAILURE-PRIVACY-CANARY" }] }],
    ["empty job id", { jobs: [{ id: "", enabled: true }] }],
    ["invalid enabled string", { jobs: [{ id: "a", enabled: "true" }] }],
    ["invalid enabled null", { jobs: [{ id: "a", enabled: null }] }],
    ["duplicate job ids", { jobs: [job("same", true), job("same", false)] }],
  ])("fails closed for $0", async (_label, registry) => {
    const { adapter } = await fixture(registry);
    const serialized = JSON.stringify(await adapter.observe(request));
    expect(JSON.parse(serialized)).toMatchObject({
      availability: "UNKNOWN",
      reviewStatus: "REVIEW_REQUIRED",
      completeness: "UNKNOWN",
      current: null,
      error: { code: "INVALID_SCHEDULER_REGISTRY", retryable: false },
    });
    expect(serialized).not.toMatch(/FAILURE-PRIVACY-CANARY|prompt|telegram|user_id/);
  });

  it("maps permission denial to UNAVAILABLE without path or raw error disclosure", async () => {
    const { adapter, registryPath } = await fixture({ jobs: [job("a", true)] });
    await chmod(registryPath, 0o000);
    const serialized = JSON.stringify(await adapter.observe(request));
    await chmod(registryPath, 0o600);
    expect(JSON.parse(serialized)).toMatchObject({
      availability: "UNAVAILABLE",
      reviewStatus: "REVIEW_REQUIRED",
      current: null,
      error: { code: "SCHEDULER_REGISTRY_UNAVAILABLE", retryable: true },
    });
    expect(serialized).not.toMatch(/approved-profile|jobs\.json|EACCES|permission|PROMPT-PRIVACY/i);
  });

  it("rejects registry, cron-directory, and profile-root symlinks", async () => {
    const fileFixture = await fixture(null);
    await mkdir(fileFixture.cronRoot);
    const outsideRegistry = resolve(fileFixture.root, "outside-jobs.json");
    await writeFile(outsideRegistry, JSON.stringify({ jobs: [] }));
    await symlink(outsideRegistry, fileFixture.registryPath);
    await expect(fileFixture.adapter.observe(request)).resolves.toMatchObject({
      availability: "UNKNOWN",
      error: { code: "SYMLINK_REJECTED" },
    });

    const directoryFixture = await fixture(null);
    const outsideCron = resolve(directoryFixture.root, "outside-cron");
    await mkdir(outsideCron);
    await writeFile(resolve(outsideCron, "jobs.json"), JSON.stringify({ jobs: [] }));
    await symlink(outsideCron, directoryFixture.cronRoot, "dir");
    await expect(directoryFixture.adapter.observe(request)).resolves.toMatchObject({
      availability: "UNKNOWN",
      error: { code: "SYMLINK_REJECTED" },
    });

    const root = await mkdtemp(resolve(tmpdir(), "mission-control-scheduler-root-symlink-"));
    roots.push(root);
    const realProfile = resolve(root, "real-profile");
    const profileLink = resolve(root, "profile-link");
    await mkdir(resolve(realProfile, "cron"), { recursive: true });
    await writeFile(resolve(realProfile, "cron", "jobs.json"), JSON.stringify({ jobs: [] }));
    await symlink(realProfile, profileLink, "dir");
    const rootSymlinkAdapter = new LocalSchedulerObservationAdapter(
      SchedulerObservationDescriptor.fromApprovedServerConfiguration({ profileRoot: profileLink }),
    );
    await expect(rootSymlinkAdapter.observe(request)).resolves.toMatchObject({
      availability: "UNKNOWN",
      error: { code: "SYMLINK_REJECTED" },
    });
  });

  it("bounds registry bytes", async () => {
    const { adapter, registryPath } = await fixture({ jobs: [] });
    await writeFile(registryPath, "x".repeat(SCHEDULER_REGISTRY_MAX_BYTES + 1), "utf8");
    await expect(adapter.observe(request)).resolves.toMatchObject({
      availability: "UNKNOWN",
      current: null,
      error: { code: "SCHEDULER_REGISTRY_TOO_LARGE", retryable: false },
    });
  });

  it("bounds job count before projecting counts", async () => {
    const jobs = Array.from({ length: SCHEDULER_MAX_JOB_COUNT + 1 }, (_, index) => ({
      id: `job-${index}`,
      enabled: true,
    }));
    const { adapter } = await fixture({ jobs });
    await expect(adapter.observe(request)).resolves.toMatchObject({
      availability: "UNKNOWN",
      current: null,
      error: { code: "SCHEDULER_JOB_LIMIT_EXCEEDED", retryable: false },
    });
  });

  it("fails closed when stable-read identities prove a concurrent replacement", () => {
    const text = JSON.stringify({ jobs: [job("privacy-canary", true)] });
    const observation = mapSchedulerRegistrySnapshot(request, {
      kind: "READ",
      text,
      before: { device: 1, inode: 10, size: text.length, modifiedMilliseconds: 1 },
      opened: { device: 1, inode: 10, size: text.length, modifiedMilliseconds: 1 },
      after: { device: 1, inode: 11, size: text.length, modifiedMilliseconds: 2 },
    });
    const serialized = JSON.stringify(observation);
    expect(JSON.parse(serialized)).toMatchObject({
      availability: "UNKNOWN",
      reviewStatus: "REVIEW_REQUIRED",
      current: null,
      error: { code: "SCHEDULER_REGISTRY_CHANGED", retryable: true },
    });
    expect(serialized).not.toMatch(/privacy-canary|PROMPT-PRIVACY|CHAT-ID|TOKEN-CANARY/);
  });

  it("preserves registry bytes and metadata during successful observation", async () => {
    const { adapter, registryPath } = await fixture({ jobs: [job("a", true)] });
    const beforeBytes = await readFile(registryPath);
    const beforeStatus = await lstat(registryPath);
    await expect(adapter.observe(request)).resolves.toMatchObject({ availability: "AVAILABLE" });
    const afterStatus = await lstat(registryPath);
    expect(await readFile(registryPath)).toEqual(beforeBytes);
    expect(afterStatus.mtimeMs).toBe(beforeStatus.mtimeMs);
    expect(afterStatus.ctimeMs).toBe(beforeStatus.ctimeMs);
    expect(afterStatus.ino).toBe(beforeStatus.ino);
  });

  it("computes freshness only from explicit timestamps and thresholds", async () => {
    const { adapter } = await fixture({ jobs: [job("a", true)] });
    await expect(
      adapter.observe({ ...request, asOf: "2027-01-01T00:00:30.001Z" }),
    ).resolves.toMatchObject({ availability: "STALE", freshness: "STALE" });
  });
});
