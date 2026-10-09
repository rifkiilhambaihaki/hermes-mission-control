import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  CHILD_ENVIRONMENT_KEYS,
  FROZEN_PRODUCTION_PROCESS_CONFIG,
  buildFrozenHermesChildEnvironment,
} from "../../../src/adapters/hermes-cli/runner/child-environment.js";

describe("Hermes child environment", () => {
  it("contains exactly the frozen allowlist and no parent canaries", () => {
    const environment = buildFrozenHermesChildEnvironment();
    expect(Object.keys(environment).sort()).toEqual([...CHILD_ENVIRONMENT_KEYS].sort());
    expect(environment).toEqual({
      PATH: FROZEN_PRODUCTION_PROCESS_CONFIG.path,
      HOME: homedir(),
      HERMES_HOME: join(homedir(), ".hermes"),
      NO_COLOR: "1",
      TERM: "dumb",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      TZ: "UTC",
    });
    expect(JSON.stringify(environment)).not.toContain("API_KEY");
    expect(JSON.stringify(environment)).not.toContain("TOKEN");
    expect(JSON.stringify(environment)).not.toContain("SSH_AUTH_SOCK");
    expect(JSON.stringify(environment)).not.toContain("HMC_BASIC_PASSWORD_HASH");
    expect(Object.isFrozen(environment)).toBe(true);
  });

  it("freezes the production working directory and executable search path", () => {
    expect(FROZEN_PRODUCTION_PROCESS_CONFIG.workingDirectory).toBe(homedir());
    expect(FROZEN_PRODUCTION_PROCESS_CONFIG.path).toBe(
      `${join(homedir(), ".local", "bin")}:/usr/local/bin:/usr/bin:/bin`,
    );
    expect(Object.isFrozen(FROZEN_PRODUCTION_PROCESS_CONFIG)).toBe(true);
  });
});
