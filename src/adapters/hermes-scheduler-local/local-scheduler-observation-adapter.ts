import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { SchedulerData } from "../../domain/scheduler/scheduler-observation.js";
import { calculateFreshness } from "../../domain/observation/freshness.js";
import { createObservation, type Observation, type Provenance } from "../../domain/observation/observation.js";
import { parseStrictJson } from "./strict-json.js";

export const LOCAL_SCHEDULER_OBSERVATION_ADAPTER_VERSION = "1.0.0" as const;
export const SCHEDULER_REGISTRY_MAX_BYTES = 4 * 1024 * 1024;
export const SCHEDULER_MAX_JOB_COUNT = 1_000;

export type SchedulerObservationErrorCode =
  | "PATH_BOUNDARY_VIOLATION"
  | "SYMLINK_REJECTED"
  | "SCHEDULER_REGISTRY_UNAVAILABLE"
  | "SCHEDULER_REGISTRY_TOO_LARGE"
  | "SCHEDULER_REGISTRY_CHANGED"
  | "INVALID_SCHEDULER_REGISTRY"
  | "SCHEDULER_JOB_LIMIT_EXCEEDED";

export interface ApprovedSchedulerObservationConfiguration {
  readonly profileRoot: string;
}

export interface SchedulerObservationRequest extends Provenance {
  readonly source: "HERMES_SCHEDULER_LOCAL";
  readonly asOf: string;
  readonly staleAfterMs: number;
  readonly expiredAfterMs: number;
}

export interface SchedulerRegistryFileIdentity {
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly modifiedMilliseconds: number;
}

export type SchedulerRegistrySnapshot =
  | { readonly kind: "MISSING" }
  | {
      readonly kind: "READ";
      readonly text: string;
      readonly before: SchedulerRegistryFileIdentity;
      readonly opened: SchedulerRegistryFileIdentity;
      readonly after: SchedulerRegistryFileIdentity;
    }
  | {
      readonly kind: "FAILURE";
      readonly code: SchedulerObservationErrorCode;
      readonly availability: "UNKNOWN" | "UNAVAILABLE";
      readonly retryable: boolean;
    };

interface SchedulerObservationPaths {
  readonly profileRoot: string;
}

class RegistryFailure extends Error {
  readonly code: SchedulerObservationErrorCode;
  readonly availability: "UNKNOWN" | "UNAVAILABLE";
  readonly retryable: boolean;

  constructor(
    code: SchedulerObservationErrorCode,
    options: {
      readonly availability?: "UNKNOWN" | "UNAVAILABLE";
      readonly retryable?: boolean;
    } = {},
  ) {
    super(code);
    this.code = code;
    this.availability = options.availability ?? "UNKNOWN";
    this.retryable = options.retryable ?? false;
  }
}

const descriptorToken = Symbol("SchedulerObservationDescriptor");
const descriptorPaths = new WeakMap<SchedulerObservationDescriptor, SchedulerObservationPaths>();

export class SchedulerObservationDescriptor {
  private constructor(token: symbol, configuration: ApprovedSchedulerObservationConfiguration) {
    if (token !== descriptorToken) throw new TypeError("Invalid Scheduler observation descriptor construction.");
    if (!isAbsolute(configuration.profileRoot)) {
      throw new TypeError("Scheduler profile root must be an absolute path.");
    }
    descriptorPaths.set(this, Object.freeze({ profileRoot: resolve(configuration.profileRoot) }));
    Object.freeze(this);
  }

  static fromApprovedServerConfiguration(
    configuration: ApprovedSchedulerObservationConfiguration,
  ): SchedulerObservationDescriptor {
    return new SchedulerObservationDescriptor(descriptorToken, configuration);
  }
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

function identityFromStatus(status: {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
}): SchedulerRegistryFileIdentity {
  return Object.freeze({
    device: status.dev,
    inode: status.ino,
    size: status.size,
    modifiedMilliseconds: status.mtimeMs,
  });
}

function sameIdentity(
  left: SchedulerRegistryFileIdentity,
  right: SchedulerRegistryFileIdentity,
): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.modifiedMilliseconds === right.modifiedMilliseconds
  );
}

async function assertApprovedDirectory(
  path: string,
  options: { readonly optional?: boolean; readonly root?: boolean } = {},
): Promise<"PRESENT" | "MISSING"> {
  let status;
  try {
    status = await lstat(path);
  } catch (error) {
    if (options.optional === true && errorCode(error) === "ENOENT") return "MISSING";
    throw new RegistryFailure("SCHEDULER_REGISTRY_UNAVAILABLE", {
      availability: "UNAVAILABLE",
      retryable: true,
    });
  }
  if (status.isSymbolicLink()) throw new RegistryFailure("SYMLINK_REJECTED");
  if (!status.isDirectory()) throw new RegistryFailure("PATH_BOUNDARY_VIOLATION");
  if (options.root === true) {
    let canonical: string;
    try {
      canonical = await realpath(path);
    } catch {
      throw new RegistryFailure("SCHEDULER_REGISTRY_UNAVAILABLE", {
        availability: "UNAVAILABLE",
        retryable: true,
      });
    }
    if (canonical !== path) throw new RegistryFailure("PATH_BOUNDARY_VIOLATION");
  }
  return "PRESENT";
}

async function readSchedulerRegistry(profileRoot: string): Promise<SchedulerRegistrySnapshot> {
  const approvedRoot = resolve(profileRoot);
  const cronRoot = resolve(approvedRoot, "cron");
  const registryPath = resolve(cronRoot, "jobs.json");
  if (!isWithin(approvedRoot, cronRoot) || !isWithin(approvedRoot, registryPath)) {
    throw new RegistryFailure("PATH_BOUNDARY_VIOLATION");
  }

  await assertApprovedDirectory(approvedRoot, { root: true });
  if ((await assertApprovedDirectory(cronRoot, { optional: true, root: true })) === "MISSING") {
    return Object.freeze({ kind: "MISSING" });
  }

  let beforeStatus;
  try {
    beforeStatus = await lstat(registryPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return Object.freeze({ kind: "MISSING" });
    throw new RegistryFailure("SCHEDULER_REGISTRY_UNAVAILABLE", {
      availability: "UNAVAILABLE",
      retryable: true,
    });
  }
  if (beforeStatus.isSymbolicLink()) throw new RegistryFailure("SYMLINK_REJECTED");
  if (!beforeStatus.isFile()) throw new RegistryFailure("PATH_BOUNDARY_VIOLATION");
  if (beforeStatus.size > SCHEDULER_REGISTRY_MAX_BYTES) {
    throw new RegistryFailure("SCHEDULER_REGISTRY_TOO_LARGE");
  }

  let canonicalRegistry: string;
  try {
    canonicalRegistry = await realpath(registryPath);
  } catch {
    throw new RegistryFailure("SCHEDULER_REGISTRY_UNAVAILABLE", {
      availability: "UNAVAILABLE",
      retryable: true,
    });
  }
  if (canonicalRegistry !== registryPath || !isWithin(approvedRoot, canonicalRegistry)) {
    throw new RegistryFailure("PATH_BOUNDARY_VIOLATION");
  }

  const before = identityFromStatus(beforeStatus);
  let handle;
  try {
    handle = await open(registryPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedStatus = await handle.stat();
    if (!openedStatus.isFile()) throw new RegistryFailure("PATH_BOUNDARY_VIOLATION");
    if (openedStatus.size > SCHEDULER_REGISTRY_MAX_BYTES) {
      throw new RegistryFailure("SCHEDULER_REGISTRY_TOO_LARGE");
    }
    const opened = identityFromStatus(openedStatus);

    let openedPath: string;
    try {
      openedPath = await realpath(`/proc/self/fd/${handle.fd}`);
    } catch {
      throw new RegistryFailure("SCHEDULER_REGISTRY_UNAVAILABLE", {
        availability: "UNAVAILABLE",
        retryable: true,
      });
    }
    if (openedPath !== registryPath || !isWithin(approvedRoot, openedPath)) {
      throw new RegistryFailure("PATH_BOUNDARY_VIOLATION");
    }

    const buffer = Buffer.alloc(SCHEDULER_REGISTRY_MAX_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > SCHEDULER_REGISTRY_MAX_BYTES) {
      throw new RegistryFailure("SCHEDULER_REGISTRY_TOO_LARGE");
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset));
    } catch {
      throw new RegistryFailure("INVALID_SCHEDULER_REGISTRY");
    }

    let afterStatus;
    try {
      afterStatus = await lstat(registryPath);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        throw new RegistryFailure("SCHEDULER_REGISTRY_CHANGED", { retryable: true });
      }
      throw new RegistryFailure("SCHEDULER_REGISTRY_UNAVAILABLE", {
        availability: "UNAVAILABLE",
        retryable: true,
      });
    }
    if (afterStatus.isSymbolicLink()) throw new RegistryFailure("SYMLINK_REJECTED");
    if (!afterStatus.isFile()) throw new RegistryFailure("PATH_BOUNDARY_VIOLATION");

    return Object.freeze({
      kind: "READ",
      text,
      before,
      opened,
      after: identityFromStatus(afterStatus),
    });
  } catch (error) {
    if (error instanceof RegistryFailure) throw error;
    if (errorCode(error) === "ENOENT") {
      throw new RegistryFailure("SCHEDULER_REGISTRY_CHANGED", { retryable: true });
    }
    throw new RegistryFailure("SCHEDULER_REGISTRY_UNAVAILABLE", {
      availability: "UNAVAILABLE",
      retryable: true,
    });
  } finally {
    await handle?.close();
  }
}

function requestProvenance(request: SchedulerObservationRequest): Provenance {
  return Object.freeze({
    source: request.source,
    observedAt: request.observedAt,
    fetchedAt: request.fetchedAt,
  });
}

function failureObservation(
  request: SchedulerObservationRequest,
  failure: {
    readonly code: SchedulerObservationErrorCode;
    readonly availability: "UNKNOWN" | "UNAVAILABLE";
    readonly retryable: boolean;
  },
): Observation<SchedulerData> {
  return createObservation<SchedulerData>({
    availability: failure.availability,
    reviewStatus: "REVIEW_REQUIRED",
    completeness: "UNKNOWN",
    freshness: "UNKNOWN",
    provenance: failure.availability === "UNKNOWN" ? requestProvenance(request) : null,
    confidence: {
      level: "NONE",
      reasons: ["The Scheduler registry could not be safely interpreted."],
    },
    current: null,
    error: {
      code: failure.code,
      message: "The local Scheduler registry is unavailable or invalid.",
      retryable: failure.retryable,
    },
    lastKnownGood: null,
  });
}

function successfulObservation(
  request: SchedulerObservationRequest,
  counts: { readonly enabled: number; readonly total: number },
  reason: string,
): Observation<SchedulerData> {
  const freshness = calculateFreshness({
    observedAt: request.observedAt,
    asOf: request.asOf,
    staleAfterMs: request.staleAfterMs,
    expiredAfterMs: request.expiredAfterMs,
  });
  const empty = counts.total === 0;
  return createObservation<SchedulerData>({
    availability: freshness === "FRESH" ? (empty ? "EMPTY" : "AVAILABLE") : "STALE",
    reviewStatus: "NONE",
    completeness: empty ? "EMPTY" : "COMPLETE",
    freshness,
    provenance: requestProvenance(request),
    confidence: {
      level: "HIGH",
      reasons: [reason],
    },
    current: Object.freeze({
      schedulerAvailability: empty ? "EMPTY" : "AVAILABLE",
      enabledJobCount: counts.enabled,
      totalJobCount: counts.total,
    }),
    error: null,
    lastKnownGood: null,
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validJobId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\")
  );
}

function projectCounts(text: string): { readonly enabled: number; readonly total: number } {
  const parsed = parseStrictJson(text);
  if (!isPlainRecord(parsed)) throw new RegistryFailure("INVALID_SCHEDULER_REGISTRY");
  const keys = Object.keys(parsed);
  if (keys.some((key) => key !== "jobs" && key !== "updated_at")) {
    throw new RegistryFailure("INVALID_SCHEDULER_REGISTRY");
  }
  if (!Array.isArray(parsed.jobs)) throw new RegistryFailure("INVALID_SCHEDULER_REGISTRY");
  if (parsed.updated_at !== undefined && typeof parsed.updated_at !== "string") {
    throw new RegistryFailure("INVALID_SCHEDULER_REGISTRY");
  }
  if (parsed.jobs.length > SCHEDULER_MAX_JOB_COUNT) {
    throw new RegistryFailure("SCHEDULER_JOB_LIMIT_EXCEEDED");
  }

  const ids = new Set<string>();
  let enabled = 0;
  for (const value of parsed.jobs) {
    if (!isPlainRecord(value) || !validJobId(value.id)) {
      throw new RegistryFailure("INVALID_SCHEDULER_REGISTRY");
    }
    if (ids.has(value.id)) throw new RegistryFailure("INVALID_SCHEDULER_REGISTRY");
    ids.add(value.id);
    if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
      throw new RegistryFailure("INVALID_SCHEDULER_REGISTRY");
    }
    if (value.enabled ?? true) enabled += 1;
  }
  return Object.freeze({ enabled, total: parsed.jobs.length });
}

export function mapSchedulerRegistrySnapshot(
  request: SchedulerObservationRequest,
  snapshot: SchedulerRegistrySnapshot,
): Observation<SchedulerData> {
  if (request.source !== "HERMES_SCHEDULER_LOCAL") {
    throw new TypeError("Scheduler observation source must be HERMES_SCHEDULER_LOCAL.");
  }
  if (snapshot.kind === "FAILURE") return failureObservation(request, snapshot);
  if (snapshot.kind === "MISSING") {
    return successfulObservation(
      request,
      { enabled: 0, total: 0 },
      "The authoritative registry has not been created; upstream semantics define zero jobs.",
    );
  }
  if (
    !sameIdentity(snapshot.before, snapshot.opened) ||
    !sameIdentity(snapshot.opened, snapshot.after)
  ) {
    return failureObservation(request, {
      code: "SCHEDULER_REGISTRY_CHANGED",
      availability: "UNKNOWN",
      retryable: true,
    });
  }

  try {
    const counts = projectCounts(snapshot.text);
    return successfulObservation(
      request,
      counts,
      "Counts were projected from a stable authoritative Scheduler registry snapshot.",
    );
  } catch (error) {
    const failure =
      error instanceof RegistryFailure
        ? error
        : new RegistryFailure("INVALID_SCHEDULER_REGISTRY");
    return failureObservation(request, failure);
  }
}

export class LocalSchedulerObservationAdapter {
  readonly #descriptor: SchedulerObservationDescriptor;

  constructor(descriptor: SchedulerObservationDescriptor) {
    this.#descriptor = descriptor;
  }

  async observe(request: SchedulerObservationRequest): Promise<Observation<SchedulerData>> {
    if (request.source !== "HERMES_SCHEDULER_LOCAL") {
      throw new TypeError("Scheduler observation source must be HERMES_SCHEDULER_LOCAL.");
    }
    const paths = descriptorPaths.get(this.#descriptor);
    if (paths === undefined) throw new TypeError("Invalid Scheduler observation descriptor.");
    try {
      return mapSchedulerRegistrySnapshot(request, await readSchedulerRegistry(paths.profileRoot));
    } catch (error) {
      const failure =
        error instanceof RegistryFailure
          ? error
          : new RegistryFailure("SCHEDULER_REGISTRY_UNAVAILABLE", {
              availability: "UNAVAILABLE",
              retryable: true,
            });
      return mapSchedulerRegistrySnapshot(request, {
        kind: "FAILURE",
        code: failure.code,
        availability: failure.availability,
        retryable: failure.retryable,
      });
    }
  }
}
