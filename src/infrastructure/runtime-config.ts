import { parsePasswordHash } from "../security/scrypt-password.js";

export interface ApplicationConfig {
  readonly applicationName: string;
  readonly applicationVersion: string;
  readonly buildId: string;
  readonly apiVersion: string;
  readonly bindAddress: "127.0.0.1";
  readonly basicUsername: string;
  readonly basicPasswordHash: string;
}

export interface RuntimeMetadata {
  readonly applicationName: string;
  readonly applicationVersion: string;
  readonly buildId: string;
  readonly apiVersion: string;
}

export interface LocalObservationPathConfig {
  readonly profileRoot: string;
  readonly sitePackagesRoot: string;
  readonly distributionMetadataDirectory: string;
  readonly editableSourceRoot: string;
  readonly schemaRoot: string;
  readonly accountingSnapshotPath: string;
  readonly bankJournalSnapshotPath: string;
  readonly submissionSnapshotPath: string;
  readonly procRoot: string;
}

export interface ServerRuntimeConfig {
  readonly port: number;
  readonly observations: LocalObservationPathConfig;
}

function requireValue(value: string, label: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} is required and must not contain surrounding whitespace.`);
  }
}

function requiredAbsolute(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name];
  if (value === undefined || !value.startsWith("/") || value.includes("\0")) {
    throw new Error(`${name} must be configured as an absolute path.`);
  }
  return value;
}

export function validateApplicationConfig(config: ApplicationConfig): ApplicationConfig {
  requireValue(config.applicationName, "Application name");
  requireValue(config.applicationVersion, "Application version");
  requireValue(config.buildId, "Build identifier");
  requireValue(config.apiVersion, "API version");
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(config.basicUsername)) {
    throw new Error("Basic username must contain only approved ASCII identifier characters.");
  }
  if (config.basicPasswordHash.length === 0) {
    throw new Error("Basic password hash is required.");
  }
  parsePasswordHash(config.basicPasswordHash);
  if (config.bindAddress !== "127.0.0.1") {
    throw new Error("Only the loopback bind address is allowed.");
  }
  return Object.freeze({ ...config });
}

export function loadRuntimeConfigFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  metadata: RuntimeMetadata,
): ApplicationConfig {
  return validateApplicationConfig({
    ...metadata,
    bindAddress: "127.0.0.1",
    basicUsername: environment.HMC_BASIC_USERNAME ?? "",
    basicPasswordHash: environment.HMC_BASIC_PASSWORD_HASH ?? "",
  });
}

export function loadServerRuntimeConfigFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): ServerRuntimeConfig {
  const rawPort = environment.HMC_PORT ?? "3200";
  if (!/^[0-9]+$/.test(rawPort)) {
    throw new Error("HMC_PORT must be an unprivileged TCP port between 1024 and 65535.");
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("HMC_PORT must be an unprivileged TCP port between 1024 and 65535.");
  }
  return Object.freeze({
    port,
    observations: Object.freeze({
      profileRoot: requiredAbsolute(environment, "HMC_HERMES_PROFILE_ROOT"),
      sitePackagesRoot: requiredAbsolute(environment, "HMC_HERMES_SITE_PACKAGES_ROOT"),
      distributionMetadataDirectory: requiredAbsolute(environment, "HMC_HERMES_DISTRIBUTION_METADATA_DIR"),
      editableSourceRoot: requiredAbsolute(environment, "HMC_HERMES_SOURCE_ROOT"),
      schemaRoot: requiredAbsolute(environment, "HMC_SCHEMA_ROOT"),
      accountingSnapshotPath: requiredAbsolute(environment, "HMC_ACCOUNTING_SNAPSHOT_PATH"),
      bankJournalSnapshotPath: requiredAbsolute(environment, "HMC_BANK_JOURNAL_SNAPSHOT_PATH"),
      submissionSnapshotPath: requiredAbsolute(environment, "HMC_SUBMISSION_SNAPSHOT_PATH"),
      procRoot: environment.HMC_PROC_ROOT === undefined
        ? "/proc"
        : requiredAbsolute(environment, "HMC_PROC_ROOT"),
    }),
  });
}

export function loadRuntimeConfig(metadata: RuntimeMetadata): ApplicationConfig {
  return loadRuntimeConfigFromEnvironment(process.env, metadata);
}

export function loadServerRuntimeConfig(): ServerRuntimeConfig {
  return loadServerRuntimeConfigFromEnvironment(process.env);
}
