import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { GatewayObservationData } from "../../domain/gateway/gateway-observation.js";
import { calculateFreshness } from "../../domain/observation/freshness.js";
import { createObservation, type Observation, type Provenance } from "../../domain/observation/observation.js";

export const LOCAL_GATEWAY_OBSERVATION_ADAPTER_VERSION = "1.0.0" as const;
export const GATEWAY_PID_RECORD_MAX_BYTES = 16 * 1024;
export const PROCESS_STAT_MAX_BYTES = 8 * 1024;

export type GatewayObservationErrorCode =
  | "PATH_BOUNDARY_VIOLATION"
  | "SYMLINK_REJECTED"
  | "PID_FILE_UNAVAILABLE"
  | "PID_FILE_TOO_LARGE"
  | "INVALID_PID_RECORD";

export interface ApprovedGatewayObservationConfiguration {
  readonly profileRoot: string;
  readonly procRoot: string;
}

export interface GatewayObservationRequest extends Provenance {
  readonly source: "HERMES_GATEWAY_LOCAL";
  readonly asOf: string;
  readonly staleAfterMs: number;
  readonly expiredAfterMs: number;
}

interface GatewayObservationPaths {
  readonly profileRoot: string;
  readonly procRoot: string;
}

interface GatewayPidRecord {
  readonly pid: number;
  readonly startTime: number | null;
  readonly identityKind: "HERMES_GATEWAY" | "LEGACY_UNVERIFIED";
}

class AdapterFailure extends Error {
  readonly code: GatewayObservationErrorCode;
  readonly availability: "UNKNOWN" | "UNAVAILABLE";
  readonly retryable: boolean;

  constructor(
    code: GatewayObservationErrorCode,
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

const descriptorToken = Symbol("GatewayObservationDescriptor");
const descriptorPaths = new WeakMap<GatewayObservationDescriptor, GatewayObservationPaths>();

export class GatewayObservationDescriptor {
  private constructor(token: symbol, configuration: ApprovedGatewayObservationConfiguration) {
    if (token !== descriptorToken) throw new TypeError("Invalid Gateway observation descriptor construction.");
    if (!isAbsolute(configuration.profileRoot) || !isAbsolute(configuration.procRoot)) {
      throw new TypeError("Gateway observation roots must be absolute paths.");
    }
    descriptorPaths.set(
      this,
      Object.freeze({
        profileRoot: resolve(configuration.profileRoot),
        procRoot: resolve(configuration.procRoot),
      }),
    );
    Object.freeze(this);
  }

  static fromApprovedServerConfiguration(
    configuration: ApprovedGatewayObservationConfiguration,
  ): GatewayObservationDescriptor {
    return new GatewayObservationDescriptor(descriptorToken, configuration);
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

async function assertDirectoryWithoutSymlink(
  path: string,
  optionalMissing = false,
): Promise<boolean> {
  try {
    const status = await lstat(path);
    if (status.isSymbolicLink()) throw new AdapterFailure("SYMLINK_REJECTED");
    if (!status.isDirectory()) throw new AdapterFailure("PATH_BOUNDARY_VIOLATION");
    return true;
  } catch (error) {
    if (error instanceof AdapterFailure) throw error;
    if (optionalMissing && errorCode(error) === "ENOENT") return false;
    throw new AdapterFailure("PATH_BOUNDARY_VIOLATION");
  }
}

async function readBoundedFile(options: {
  readonly boundaryRoot: string;
  readonly file: string;
  readonly maximumBytes: number;
  readonly optional: boolean;
  readonly unavailableCode: GatewayObservationErrorCode;
  readonly tooLargeCode: GatewayObservationErrorCode;
}): Promise<string | null> {
  const lexicalRoot = resolve(options.boundaryRoot);
  const lexicalFile = resolve(options.file);
  if (!isWithin(lexicalRoot, lexicalFile)) throw new AdapterFailure("PATH_BOUNDARY_VIOLATION");
  await assertDirectoryWithoutSymlink(lexicalRoot);

  const components = relative(lexicalRoot, lexicalFile).split(/[\\/]/).filter(Boolean);
  let cursor = lexicalRoot;
  for (const component of components.slice(0, -1)) {
    cursor = resolve(cursor, component);
    if (!(await assertDirectoryWithoutSymlink(cursor, options.optional))) return null;
  }

  let status;
  try {
    status = await lstat(lexicalFile);
  } catch (error) {
    if (errorCode(error) === "ENOENT" && options.optional) return null;
    throw new AdapterFailure(options.unavailableCode, {
      availability: "UNAVAILABLE",
      retryable: true,
    });
  }
  if (status.isSymbolicLink()) throw new AdapterFailure("SYMLINK_REJECTED");
  if (!status.isFile()) throw new AdapterFailure("PATH_BOUNDARY_VIOLATION");
  if (status.size > options.maximumBytes) throw new AdapterFailure(options.tooLargeCode);

  let rootIdentity: string;
  let fileIdentity: string;
  try {
    [rootIdentity, fileIdentity] = await Promise.all([realpath(lexicalRoot), realpath(lexicalFile)]);
  } catch {
    throw new AdapterFailure(options.unavailableCode, {
      availability: "UNAVAILABLE",
      retryable: true,
    });
  }
  if (rootIdentity !== lexicalRoot || fileIdentity !== lexicalFile) {
    throw new AdapterFailure("PATH_BOUNDARY_VIOLATION");
  }
  if (!isWithin(rootIdentity, fileIdentity)) throw new AdapterFailure("PATH_BOUNDARY_VIOLATION");

  let handle;
  try {
    handle = await open(lexicalFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedStatus = await handle.stat();
    if (!openedStatus.isFile()) throw new AdapterFailure("PATH_BOUNDARY_VIOLATION");
    if (openedStatus.size > options.maximumBytes) throw new AdapterFailure(options.tooLargeCode);

    let openedIdentity: string;
    try {
      openedIdentity = await realpath(`/proc/self/fd/${handle.fd}`);
    } catch {
      throw new AdapterFailure(options.unavailableCode, {
        availability: "UNAVAILABLE",
        retryable: true,
      });
    }
    if (openedIdentity !== fileIdentity || !isWithin(rootIdentity, openedIdentity)) {
      throw new AdapterFailure("PATH_BOUNDARY_VIOLATION");
    }

    const buffer = Buffer.alloc(options.maximumBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > options.maximumBytes) throw new AdapterFailure(options.tooLargeCode);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset));
    } catch {
      throw new AdapterFailure(options.unavailableCode, {
        availability: "UNAVAILABLE",
        retryable: false,
      });
    }
  } catch (error) {
    if (error instanceof AdapterFailure) throw error;
    if (errorCode(error) === "ENOENT" && options.optional) return null;
    throw new AdapterFailure(options.unavailableCode, {
      availability: "UNAVAILABLE",
      retryable: true,
    });
  } finally {
    await handle?.close();
  }
}

function parsePidRecord(text: string): GatewayPidRecord {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AdapterFailure("INVALID_PID_RECORD");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AdapterFailure("INVALID_PID_RECORD");
  }
  const record = value as Record<string, unknown>;
  const pid = record.pid;
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0 || Number(pid) > 2_147_483_647) {
    throw new AdapterFailure("INVALID_PID_RECORD");
  }

  const hasKind = Object.hasOwn(record, "kind");
  const hasStartTime = Object.hasOwn(record, "start_time");
  if (!hasKind && !hasStartTime) {
    return Object.freeze({
      pid: Number(pid),
      startTime: null,
      identityKind: "LEGACY_UNVERIFIED" as const,
    });
  }
  if (
    record.kind !== "hermes-gateway" ||
    !Number.isSafeInteger(record.start_time) ||
    Number(record.start_time) <= 0
  ) {
    throw new AdapterFailure("INVALID_PID_RECORD");
  }
  return Object.freeze({
    pid: Number(pid),
    startTime: Number(record.start_time),
    identityKind: "HERMES_GATEWAY" as const,
  });
}

function parseProcessStartTime(text: string, expectedPid: number): number {
  const closeParenthesis = text.lastIndexOf(")");
  if (closeParenthesis < 3) throw new Error("INVALID_PROCESS_STAT");
  const prefix = text.slice(0, text.indexOf(" (")).trim();
  if (prefix !== String(expectedPid)) throw new Error("INVALID_PROCESS_STAT");
  const fieldsFromState = text.slice(closeParenthesis + 1).trim().split(/\s+/);
  const startTime = fieldsFromState[19];
  if (!/^[1-9][0-9]*$/.test(startTime ?? "")) throw new Error("INVALID_PROCESS_STAT");
  const parsed = Number(startTime);
  if (!Number.isSafeInteger(parsed)) throw new Error("INVALID_PROCESS_STAT");
  return parsed;
}

function unknownServiceDimensions(): Omit<
  GatewayObservationData,
  "processState" | "processIdentityConsistency"
> {
  return Object.freeze({
    processMode: "UNKNOWN",
    userServiceState: "UNKNOWN",
    systemServiceState: "UNKNOWN",
    managerCategory: "UNKNOWN",
    duplicateDefinitionState: "UNKNOWN",
    serviceDefinitionState: "UNKNOWN",
  });
}

function currentData(
  processState: GatewayObservationData["processState"],
  processIdentityConsistency: GatewayObservationData["processIdentityConsistency"],
): GatewayObservationData {
  return Object.freeze({
    processState,
    processIdentityConsistency,
    ...unknownServiceDimensions(),
  });
}

function provenance(request: GatewayObservationRequest): Provenance {
  return Object.freeze({
    source: request.source,
    observedAt: request.observedAt,
    fetchedAt: request.fetchedAt,
  });
}

function currentObservation(
  request: GatewayObservationRequest,
  data: GatewayObservationData,
  options: {
    readonly reviewStatus: "NONE" | "REVIEW_REQUIRED";
    readonly confidenceLevel: "MEDIUM" | "LOW";
    readonly reasons: readonly string[];
  },
): Observation<GatewayObservationData> {
  const freshness = calculateFreshness({
    observedAt: request.observedAt,
    asOf: request.asOf,
    staleAfterMs: request.staleAfterMs,
    expiredAfterMs: request.expiredAfterMs,
  });
  return createObservation({
    availability: freshness === "FRESH" ? "AVAILABLE" : "STALE",
    reviewStatus: options.reviewStatus,
    completeness: "PARTIAL",
    freshness,
    provenance: provenance(request),
    confidence: {
      level: options.confidenceLevel,
      reasons: Object.freeze([...options.reasons]),
    },
    current: data,
    error: null,
    lastKnownGood: null,
  });
}

function failedObservation(
  request: GatewayObservationRequest,
  failure: AdapterFailure,
): Observation<GatewayObservationData> {
  return createObservation<GatewayObservationData>({
    availability: failure.availability,
    reviewStatus: "REVIEW_REQUIRED",
    completeness: "UNKNOWN",
    freshness: "UNKNOWN",
    provenance: failure.availability === "UNKNOWN" ? provenance(request) : null,
    confidence: { level: "NONE", reasons: ["Gateway observation source could not be safely interpreted."] },
    current: null,
    error: {
      code: failure.code,
      message: "The local Gateway observation source is unavailable or invalid.",
      retryable: failure.retryable,
    },
    lastKnownGood: null,
  });
}

const SERVICE_DIMENSION_REASON =
  "Service-manager dimensions are not observed by Gateway Adapter V1.";

export class LocalGatewayObservationAdapter {
  readonly #descriptor: GatewayObservationDescriptor;

  constructor(descriptor: GatewayObservationDescriptor) {
    this.#descriptor = descriptor;
  }

  async observe(request: GatewayObservationRequest): Promise<Observation<GatewayObservationData>> {
    if (request.source !== "HERMES_GATEWAY_LOCAL") {
      throw new TypeError("Gateway observation source must be HERMES_GATEWAY_LOCAL.");
    }
    const paths = descriptorPaths.get(this.#descriptor);
    if (paths === undefined) throw new TypeError("Invalid Gateway observation descriptor.");

    let pidText: string | null;
    try {
      pidText = await readBoundedFile({
        boundaryRoot: paths.profileRoot,
        file: resolve(paths.profileRoot, "gateway.pid"),
        maximumBytes: GATEWAY_PID_RECORD_MAX_BYTES,
        optional: true,
        unavailableCode: "PID_FILE_UNAVAILABLE",
        tooLargeCode: "PID_FILE_TOO_LARGE",
      });
    } catch (error) {
      return failedObservation(
        request,
        error instanceof AdapterFailure ? error : new AdapterFailure("PID_FILE_UNAVAILABLE"),
      );
    }

    if (pidText === null) {
      return currentObservation(request, currentData("UNKNOWN", "UNKNOWN"), {
        reviewStatus: "REVIEW_REQUIRED",
        confidenceLevel: "LOW",
        reasons: [
          "No Gateway PID record was present, so process state cannot be proven.",
          SERVICE_DIMENSION_REASON,
        ],
      });
    }

    let record: GatewayPidRecord;
    try {
      record = parsePidRecord(pidText);
    } catch (error) {
      return failedObservation(
        request,
        error instanceof AdapterFailure ? error : new AdapterFailure("INVALID_PID_RECORD"),
      );
    }

    if (record.identityKind === "LEGACY_UNVERIFIED" || record.startTime === null) {
      return currentObservation(request, currentData("UNKNOWN", "UNKNOWN"), {
        reviewStatus: "REVIEW_REQUIRED",
        confidenceLevel: "LOW",
        reasons: [
          "The PID record lacks a verifiable process start identity.",
          SERVICE_DIMENSION_REASON,
        ],
      });
    }

    const statFile = resolve(paths.procRoot, String(record.pid), "stat");
    let firstStat: string | null;
    try {
      firstStat = await readBoundedFile({
        boundaryRoot: paths.procRoot,
        file: statFile,
        maximumBytes: PROCESS_STAT_MAX_BYTES,
        optional: true,
        unavailableCode: "PID_FILE_UNAVAILABLE",
        tooLargeCode: "PID_FILE_TOO_LARGE",
      });
    } catch {
      return currentObservation(request, currentData("UNKNOWN", "UNKNOWN"), {
        reviewStatus: "REVIEW_REQUIRED",
        confidenceLevel: "LOW",
        reasons: [
          "Kernel process identity could not be read safely.",
          SERVICE_DIMENSION_REASON,
        ],
      });
    }

    if (firstStat === null) {
      return currentObservation(request, currentData("UNKNOWN", "INCONSISTENT"), {
        reviewStatus: "REVIEW_REQUIRED",
        confidenceLevel: "LOW",
        reasons: [
          "The PID record does not reference a current kernel process.",
          SERVICE_DIMENSION_REASON,
        ],
      });
    }

    let firstStartTime: number;
    try {
      firstStartTime = parseProcessStartTime(firstStat, record.pid);
    } catch {
      return currentObservation(request, currentData("UNKNOWN", "UNKNOWN"), {
        reviewStatus: "REVIEW_REQUIRED",
        confidenceLevel: "LOW",
        reasons: [
          "Kernel process identity did not match the bounded stat contract.",
          SERVICE_DIMENSION_REASON,
        ],
      });
    }

    if (firstStartTime !== record.startTime) {
      return currentObservation(request, currentData("UNKNOWN", "INCONSISTENT"), {
        reviewStatus: "REVIEW_REQUIRED",
        confidenceLevel: "LOW",
        reasons: [
          "The PID was reused by a process with a different start identity.",
          SERVICE_DIMENSION_REASON,
        ],
      });
    }

    let secondStat: string | null;
    try {
      secondStat = await readBoundedFile({
        boundaryRoot: paths.procRoot,
        file: statFile,
        maximumBytes: PROCESS_STAT_MAX_BYTES,
        optional: true,
        unavailableCode: "PID_FILE_UNAVAILABLE",
        tooLargeCode: "PID_FILE_TOO_LARGE",
      });
    } catch {
      return currentObservation(request, currentData("UNKNOWN", "UNKNOWN"), {
        reviewStatus: "REVIEW_REQUIRED",
        confidenceLevel: "LOW",
        reasons: [
          "Kernel process identity could not be confirmed twice.",
          SERVICE_DIMENSION_REASON,
        ],
      });
    }

    if (secondStat === null) {
      return currentObservation(request, currentData("UNKNOWN", "INCONSISTENT"), {
        reviewStatus: "REVIEW_REQUIRED",
        confidenceLevel: "LOW",
        reasons: [
          "The process exited during bounded identity verification.",
          SERVICE_DIMENSION_REASON,
        ],
      });
    }

    try {
      if (parseProcessStartTime(secondStat, record.pid) !== record.startTime) {
        return currentObservation(request, currentData("UNKNOWN", "INCONSISTENT"), {
          reviewStatus: "REVIEW_REQUIRED",
          confidenceLevel: "LOW",
          reasons: [
            "The process identity changed during bounded verification.",
            SERVICE_DIMENSION_REASON,
          ],
        });
      }
    } catch {
      return currentObservation(request, currentData("UNKNOWN", "UNKNOWN"), {
        reviewStatus: "REVIEW_REQUIRED",
        confidenceLevel: "LOW",
        reasons: [
          "The second kernel identity read did not match the bounded stat contract.",
          SERVICE_DIMENSION_REASON,
        ],
      });
    }

    return currentObservation(request, currentData("RUNNING", "CONSISTENT"), {
      reviewStatus: "NONE",
      confidenceLevel: "MEDIUM",
      reasons: [
        "PID record and kernel process start identity matched.",
        SERVICE_DIMENSION_REASON,
      ],
    });
  }
}
