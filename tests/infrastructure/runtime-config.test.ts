import { describe, expect, it } from "vitest";

import {
  loadRuntimeConfigFromEnvironment,
  loadServerRuntimeConfigFromEnvironment,
  validateApplicationConfig,
  type RuntimeMetadata,
} from "../../src/infrastructure/runtime-config.js";
import { encodePasswordHash } from "../../src/security/scrypt-password.js";

const metadata: RuntimeMetadata = {
  applicationName: "Hermes Mission Control",
  applicationVersion: "0.1.0-test",
  buildId: "synthetic-local",
  apiVersion: "v1",
};

describe("runtime configuration boundary", () => {
  it("maps only explicit Mission Control credential names", async () => {
    const hash = await encodePasswordHash("Synthetic-Password-Only", Buffer.alloc(16, 0x44));
    const config = loadRuntimeConfigFromEnvironment(
      {
        HMC_BASIC_USERNAME: "synthetic-user",
        HMC_BASIC_PASSWORD_HASH: hash,
        TELEGRAM_TOKEN: "FAKE_SHOULD_NOT_BE_MAPPED",
        GOOGLE_CREDENTIAL: "FAKE_SHOULD_NOT_BE_MAPPED",
        HERMES_PASSWORD: "FAKE_SHOULD_NOT_BE_MAPPED",
      },
      metadata,
    );
    expect(config).toEqual({
      ...metadata,
      bindAddress: "127.0.0.1",
      basicUsername: "synthetic-user",
      basicPasswordHash: hash,
    });
    expect(JSON.stringify(config)).not.toContain("FAKE_SHOULD_NOT_BE_MAPPED");
  });

  it("fails closed when either credential variable is absent", async () => {
    const hash = await encodePasswordHash("Synthetic-Password-Only", Buffer.alloc(16, 0x44));
    expect(() =>
      loadRuntimeConfigFromEnvironment({ HMC_BASIC_PASSWORD_HASH: hash }, metadata),
    ).toThrow();
    expect(() =>
      loadRuntimeConfigFromEnvironment({ HMC_BASIC_USERNAME: "synthetic-user" }, metadata),
    ).toThrow();
  });

  it("returns a frozen validated configuration", async () => {
    const hash = await encodePasswordHash("Synthetic-Password-Only", Buffer.alloc(16, 0x44));
    const config = validateApplicationConfig({
      ...metadata,
      bindAddress: "127.0.0.1",
      basicUsername: "synthetic-user",
      basicPasswordHash: hash,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("maps only explicit absolute observation paths and a bounded port", () => {
    const config = loadServerRuntimeConfigFromEnvironment({
      HMC_PORT: "4175",
      HMC_HERMES_PROFILE_ROOT: "/srv/example/hermes",
      HMC_HERMES_SITE_PACKAGES_ROOT: "/srv/example/site-packages",
      HMC_HERMES_DISTRIBUTION_METADATA_DIR: "/srv/example/hermes-agent.dist-info",
      HMC_HERMES_SOURCE_ROOT: "/srv/example/hermes-agent",
      HMC_SCHEMA_ROOT: "/srv/example/mission-control/schemas",
      HMC_ACCOUNTING_SNAPSHOT_PATH: "/srv/example/snapshots/accounting_v2.snapshot.json",
      HMC_BANK_JOURNAL_SNAPSHOT_PATH: "/srv/example/snapshots/bank_journal_quality.snapshot.json",
      HMC_SUBMISSION_SNAPSHOT_PATH: "/srv/example/snapshots/submission_tracker.snapshot.json",
      UNRELATED_SECRET: "FAKE_NOT_MAPPED",
    });
    expect(config.port).toBe(4175);
    expect(config.observations.procRoot).toBe("/proc");
    expect(JSON.stringify(config)).not.toContain("FAKE_NOT_MAPPED");
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.observations)).toBe(true);
  });

  it("fails closed on missing or relative paths and invalid ports", () => {
    expect(() => loadServerRuntimeConfigFromEnvironment({ HMC_PORT: "80" })).toThrow();
    expect(() => loadServerRuntimeConfigFromEnvironment({ HMC_PORT: "not-a-port" })).toThrow();
    expect(() => loadServerRuntimeConfigFromEnvironment({
      HMC_HERMES_PROFILE_ROOT: "relative/path",
    })).toThrow();
  });
});
