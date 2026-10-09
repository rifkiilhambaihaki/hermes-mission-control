import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GATEWAY_PID_RECORD_MAX_BYTES,
  GatewayObservationDescriptor,
  LocalGatewayObservationAdapter,
} from "../../../src/adapters/hermes-gateway-local/index.js";

const roots: string[] = [];
const fixedTime = "2027-01-01T00:00:00.000Z";
const request = {
  source: "HERMES_GATEWAY_LOCAL" as const,
  observedAt: fixedTime,
  fetchedAt: fixedTime,
  asOf: fixedTime,
  staleAfterMs: 30_000,
  expiredAfterMs: 60_000,
};

function procStat(pid: number, startTime: number): string {
  return `${pid} (synthetic gateway worker) S ${Array.from({ length: 18 }, () => "0").join(" ")} ${startTime} 0\n`;
}

async function fixture(options: {
  readonly pidRecord?: unknown | null;
  readonly procStartTime?: number | null;
  readonly pid?: number;
} = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "mission-control-gateway-observation-"));
  roots.push(root);
  const profileRoot = resolve(root, "approved-profile");
  const procRoot = resolve(root, "approved-proc");
  const pid = options.pid ?? 4242;
  await mkdir(profileRoot, { recursive: true });
  await mkdir(procRoot, { recursive: true });
  const pidPath = resolve(profileRoot, "gateway.pid");
  if (options.pidRecord !== null) {
    await writeFile(
      pidPath,
      JSON.stringify(
        options.pidRecord ?? {
          pid,
          kind: "hermes-gateway",
          start_time: 987654,
          argv: ["COMMAND-LINE-PRIVACY-CANARY", "/private/path/canary"],
        },
      ),
      "utf8",
    );
  }
  if (options.procStartTime !== null) {
    const processRoot = resolve(procRoot, String(pid));
    await mkdir(processRoot, { recursive: true });
    await writeFile(resolve(processRoot, "stat"), procStat(pid, options.procStartTime ?? 987654), "utf8");
  }
  const descriptor = GatewayObservationDescriptor.fromApprovedServerConfiguration({
    profileRoot,
    procRoot,
  });
  return {
    root,
    profileRoot,
    procRoot,
    pid,
    pidPath,
    adapter: new LocalGatewayObservationAdapter(descriptor),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("LocalGatewayObservationAdapter", () => {
  it("observes a running process only when kind and kernel start identity are consistent", async () => {
    const { adapter } = await fixture();
    const observation = await adapter.observe(request);
    expect(observation).toEqual({
      availability: "AVAILABLE",
      reviewStatus: "NONE",
      completeness: "PARTIAL",
      freshness: "FRESH",
      provenance: {
        source: "HERMES_GATEWAY_LOCAL",
        observedAt: fixedTime,
        fetchedAt: fixedTime,
      },
      confidence: {
        level: "MEDIUM",
        reasons: [
          "PID record and kernel process start identity matched.",
          "Service-manager dimensions are not observed by Gateway Adapter V1.",
        ],
      },
      current: {
        processState: "RUNNING",
        processIdentityConsistency: "CONSISTENT",
        processMode: "UNKNOWN",
        userServiceState: "UNKNOWN",
        systemServiceState: "UNKNOWN",
        managerCategory: "UNKNOWN",
        duplicateDefinitionState: "UNKNOWN",
        serviceDefinitionState: "UNKNOWN",
      },
      error: null,
      lastKnownGood: null,
    });
    expect(JSON.stringify(observation)).not.toMatch(/4242|987654|COMMAND-LINE|private\/path/);
  });

  it("maps an absent PID file to UNKNOWN without treating it as a transport failure", async () => {
    const { adapter, pidPath } = await fixture({ pidRecord: null, procStartTime: null });
    await expect(adapter.observe(request)).resolves.toMatchObject({
      availability: "AVAILABLE",
      reviewStatus: "REVIEW_REQUIRED",
      completeness: "PARTIAL",
      confidence: { level: "LOW" },
      current: {
        processState: "UNKNOWN",
        processIdentityConsistency: "UNKNOWN",
        processMode: "UNKNOWN",
        userServiceState: "UNKNOWN",
        systemServiceState: "UNKNOWN",
      },
      error: null,
    });
    await expect(lstat(pidPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not report false STOPPED during a handoff with a missing PID record", async () => {
    const { adapter } = await fixture({ pidRecord: null });
    await expect(adapter.observe(request)).resolves.toMatchObject({
      availability: "AVAILABLE",
      reviewStatus: "REVIEW_REQUIRED",
      completeness: "PARTIAL",
      current: {
        processState: "UNKNOWN",
        processIdentityConsistency: "UNKNOWN",
      },
    });
  });

  it("reports stale PID metadata without deleting or repairing it", async () => {
    const { adapter, pidPath } = await fixture({ procStartTime: null });
    const before = await readFile(pidPath);
    const beforeStatus = await lstat(pidPath);
    const observation = await adapter.observe(request);
    const afterStatus = await lstat(pidPath);
    expect(observation).toMatchObject({
      availability: "AVAILABLE",
      reviewStatus: "REVIEW_REQUIRED",
      current: {
        processState: "UNKNOWN",
        processIdentityConsistency: "INCONSISTENT",
      },
    });
    expect(await readFile(pidPath)).toEqual(before);
    expect(afterStatus.mtimeMs).toBe(beforeStatus.mtimeMs);
  });

  it("detects PID reuse from a kernel start-time mismatch", async () => {
    const { adapter } = await fixture({ procStartTime: 987655 });
    await expect(adapter.observe(request)).resolves.toMatchObject({
      availability: "AVAILABLE",
      reviewStatus: "REVIEW_REQUIRED",
      current: {
        processState: "UNKNOWN",
        processIdentityConsistency: "INCONSISTENT",
      },
      confidence: { level: "LOW" },
    });
  });

  it("does not claim RUNNING for a legacy PID-only record that cannot prove reuse safety", async () => {
    const { adapter } = await fixture({ pidRecord: { pid: 4242 } });
    await expect(adapter.observe(request)).resolves.toMatchObject({
      availability: "AVAILABLE",
      reviewStatus: "REVIEW_REQUIRED",
      current: {
        processState: "UNKNOWN",
        processIdentityConsistency: "UNKNOWN",
      },
    });
  });

  it("returns UNKNOWN with a controlled error for malformed or wrong-kind PID records", async () => {
    for (const pidRecord of [
      { pid: "not-an-integer", kind: "hermes-gateway", start_time: 1 },
      { pid: 4242, kind: "unrelated-process", start_time: 987654 },
      { pid: 4242, kind: "hermes-gateway", start_time: -1 },
      [4242],
    ]) {
      const { adapter } = await fixture({ pidRecord });
      const serialized = JSON.stringify(await adapter.observe(request));
      expect(JSON.parse(serialized)).toMatchObject({
        availability: "UNKNOWN",
        reviewStatus: "REVIEW_REQUIRED",
        current: null,
        error: { code: "INVALID_PID_RECORD", retryable: false },
      });
      expect(serialized).not.toContain("unrelated-process");
    }
  });

  it("returns UNAVAILABLE for permission denial without exposing a path or raw error", async () => {
    const { adapter, pidPath } = await fixture();
    await chmod(pidPath, 0o000);
    const serialized = JSON.stringify(await adapter.observe(request));
    await chmod(pidPath, 0o600);
    expect(JSON.parse(serialized)).toMatchObject({
      availability: "UNAVAILABLE",
      reviewStatus: "REVIEW_REQUIRED",
      current: null,
      error: { code: "PID_FILE_UNAVAILABLE", retryable: true },
    });
    expect(serialized).not.toMatch(/approved-profile|gateway\.pid|EACCES|permission/i);
  });

  it("keeps a permission-denied process observation partial and review-required", async () => {
    const { adapter, procRoot, pid } = await fixture();
    const statPath = resolve(procRoot, String(pid), "stat");
    await chmod(statPath, 0o000);
    const observation = await adapter.observe(request);
    await chmod(statPath, 0o600);
    expect(observation).toMatchObject({
      availability: "AVAILABLE",
      reviewStatus: "REVIEW_REQUIRED",
      completeness: "PARTIAL",
      confidence: { level: "LOW" },
      current: {
        processState: "UNKNOWN",
        processIdentityConsistency: "UNKNOWN",
      },
      error: null,
    });
  });

  it("rejects PID-file and proc-stat symlinks without following them", async () => {
    const pidFixture = await fixture({ pidRecord: null, procStartTime: null });
    const outsidePid = resolve(pidFixture.root, "outside-pid");
    await writeFile(outsidePid, JSON.stringify({ pid: 4242, kind: "hermes-gateway", start_time: 1 }));
    await symlink(outsidePid, pidFixture.pidPath);
    await expect(pidFixture.adapter.observe(request)).resolves.toMatchObject({
      availability: "UNKNOWN",
      error: { code: "SYMLINK_REJECTED" },
    });

    const root = await mkdtemp(resolve(tmpdir(), "mission-control-gateway-root-symlink-"));
    roots.push(root);
    const realProfile = resolve(root, "real-profile");
    const profileLink = resolve(root, "profile-link");
    const procRoot = resolve(root, "proc");
    await mkdir(realProfile);
    await mkdir(procRoot);
    await writeFile(
      resolve(realProfile, "gateway.pid"),
      JSON.stringify({ pid: 4242, kind: "hermes-gateway", start_time: 987654 }),
    );
    await symlink(realProfile, profileLink, "dir");
    const rootSymlinkAdapter = new LocalGatewayObservationAdapter(
      GatewayObservationDescriptor.fromApprovedServerConfiguration({
        profileRoot: profileLink,
        procRoot,
      }),
    );
    await expect(rootSymlinkAdapter.observe(request)).resolves.toMatchObject({
      availability: "UNKNOWN",
      error: { code: "SYMLINK_REJECTED" },
    });

    const procFixture = await fixture();
    const statPath = resolve(procFixture.procRoot, String(procFixture.pid), "stat");
    const outsideStat = resolve(procFixture.root, "outside-stat");
    await writeFile(outsideStat, procStat(procFixture.pid, 987654));
    await rm(statPath);
    await symlink(outsideStat, statPath);
    await expect(procFixture.adapter.observe(request)).resolves.toMatchObject({
      availability: "AVAILABLE",
      reviewStatus: "REVIEW_REQUIRED",
      current: { processState: "UNKNOWN", processIdentityConsistency: "UNKNOWN" },
    });
  });

  it("bounds PID record reads", async () => {
    const { adapter, pidPath } = await fixture();
    await writeFile(pidPath, "x".repeat(GATEWAY_PID_RECORD_MAX_BYTES + 1), "utf8");
    await expect(adapter.observe(request)).resolves.toMatchObject({
      availability: "UNKNOWN",
      current: null,
      error: { code: "PID_FILE_TOO_LARGE", retryable: false },
    });
  });

  it("computes freshness only from the explicit clock and thresholds", async () => {
    const { adapter } = await fixture();
    await expect(
      adapter.observe({
        ...request,
        asOf: "2027-01-01T00:00:30.001Z",
      }),
    ).resolves.toMatchObject({ availability: "STALE", freshness: "STALE" });
  });

  it("never infers service-manager dimensions from process success", async () => {
    const { adapter } = await fixture();
    await expect(adapter.observe(request)).resolves.toMatchObject({
      current: {
        processState: "RUNNING",
        processMode: "UNKNOWN",
        userServiceState: "UNKNOWN",
        systemServiceState: "UNKNOWN",
        managerCategory: "UNKNOWN",
        duplicateDefinitionState: "UNKNOWN",
        serviceDefinitionState: "UNKNOWN",
      },
    });
  });
});
