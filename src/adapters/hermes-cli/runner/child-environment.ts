import { homedir } from "node:os";
import { join } from "node:path";

export const CHILD_ENVIRONMENT_KEYS = [
  "PATH",
  "HOME",
  "HERMES_HOME",
  "NO_COLOR",
  "TERM",
  "LANG",
  "LC_ALL",
  "TZ",
] as const;

const home = homedir();

export const FROZEN_PRODUCTION_PROCESS_CONFIG = Object.freeze({
  path: `${join(home, ".local", "bin")}:/usr/local/bin:/usr/bin:/bin`,
  home,
  hermesHome: join(home, ".hermes"),
  workingDirectory: home,
});

export function buildFrozenHermesChildEnvironment(): Readonly<NodeJS.ProcessEnv> {
  return Object.freeze({
    PATH: FROZEN_PRODUCTION_PROCESS_CONFIG.path,
    HOME: FROZEN_PRODUCTION_PROCESS_CONFIG.home,
    HERMES_HOME: FROZEN_PRODUCTION_PROCESS_CONFIG.hermesHome,
    NO_COLOR: "1",
    TERM: "dumb",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TZ: "UTC",
  });
}
