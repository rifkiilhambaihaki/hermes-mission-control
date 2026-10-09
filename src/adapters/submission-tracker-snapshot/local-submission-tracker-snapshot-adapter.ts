import { constants } from "node:fs";
import { lstat, open, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

import { validateSubmissionSnapshotSemantics } from "../../domain/contracts/semantic-validation.js";
import type { SubmissionData, SubmissionSnapshot } from "../../domain/contracts/snapshot-types.js";
import { calculateFreshness } from "../../domain/observation/freshness.js";
import { createObservation, type Observation } from "../../domain/observation/observation.js";
import { parseStrictJson } from "./strict-json.js";

const MAX_SNAPSHOT_BYTES = 262_144;
const REQUIRED_DIRECTORY_MODE = 0o700;
const REQUIRED_FILE_MODE = 0o600;
const SUBMISSION_SCHEMA_ID = "https://mission-control.local/schemas/submission_tracker.snapshot.schema.json";

export interface SubmissionTrackerSnapshotObservationRequest {
  readonly source: "SUBMISSION_TRACKER_LOCAL_SNAPSHOT";
  readonly asOf: string;
  readonly staleAfterMs: number;
  readonly expiredAfterMs: number;
  readonly futureToleranceMs: number;
}

export interface ApprovedSubmissionTrackerSnapshotConfiguration {
  readonly snapshotPath: string;
  readonly schemaRoot: string;
}

function identity(value: Awaited<ReturnType<typeof stat>>): string {
  return `${value.dev}:${value.ino}:${value.size}:${value.mtimeMs}`;
}

function mode(value: number): number {
  return value & 0o777;
}

function currentIdentity(): { readonly uid: number; readonly gid: number } {
  const getuid = process.getuid;
  const getgid = process.getgid;
  if (getuid === undefined || getgid === undefined) throw new Error("SUBMISSION_SNAPSHOT_INSECURE");
  return { uid: getuid(), gid: getgid() };
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  const expected = currentIdentity();
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error("SUBMISSION_SNAPSHOT_PATH_UNSAFE");
  if (mode(metadata.mode) !== REQUIRED_DIRECTORY_MODE || metadata.uid !== expected.uid || metadata.gid !== expected.gid) {
    throw new Error("SUBMISSION_SNAPSHOT_INSECURE");
  }
  if (await realpath(path) !== resolve(path)) throw new Error("SUBMISSION_SNAPSHOT_PATH_UNSAFE");
}

export class SubmissionTrackerSnapshotDescriptor {
  readonly snapshotPath: string;
  readonly schemaRoot: string;

  private constructor(configuration: ApprovedSubmissionTrackerSnapshotConfiguration) {
    this.snapshotPath = resolve(configuration.snapshotPath);
    this.schemaRoot = resolve(configuration.schemaRoot);
    Object.freeze(this);
  }

  static fromApprovedServerConfiguration(
    configuration: ApprovedSubmissionTrackerSnapshotConfiguration,
  ): SubmissionTrackerSnapshotDescriptor {
    if (!isAbsolute(configuration.snapshotPath) || !isAbsolute(configuration.schemaRoot)) {
      throw new TypeError("Submission snapshot configuration must use absolute paths.");
    }
    if (basename(configuration.snapshotPath) !== "submission_tracker.snapshot.json") {
      throw new TypeError("Submission snapshot filename is not approved.");
    }
    return new SubmissionTrackerSnapshotDescriptor(configuration);
  }
}

async function compileValidator(schemaRoot: string): Promise<ValidateFunction<SubmissionSnapshot>> {
  const [commonText, submissionText] = await Promise.all([
    readFile(resolve(schemaRoot, "common.snapshot.defs.schema.json"), "utf8"),
    readFile(resolve(schemaRoot, "submission_tracker.snapshot.schema.json"), "utf8"),
  ]);
  const common = parseStrictJson(commonText) as object;
  const submission = parseStrictJson(submissionText) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const addFormats = addFormatsModule as unknown as (instance: Ajv2020) => void;
  addFormats(ajv);
  ajv.addSchema(common);
  ajv.addSchema(submission);
  const validator = ajv.getSchema<SubmissionSnapshot>(SUBMISSION_SCHEMA_ID);
  if (validator === undefined) throw new Error("SUBMISSION_SCHEMA_UNAVAILABLE");
  return validator;
}

export class LocalSubmissionTrackerSnapshotAdapter {
  readonly #descriptor: SubmissionTrackerSnapshotDescriptor;
  readonly #validator: Promise<ValidateFunction<SubmissionSnapshot>>;

  constructor(descriptor: SubmissionTrackerSnapshotDescriptor) {
    this.#descriptor = descriptor;
    this.#validator = compileValidator(descriptor.schemaRoot);
  }

  async #readSnapshot(): Promise<SubmissionSnapshot> {
    const snapshotDirectory = dirname(this.#descriptor.snapshotPath);
    await assertPrivateDirectory(dirname(snapshotDirectory));
    await assertPrivateDirectory(snapshotDirectory);
    const before = await lstat(this.#descriptor.snapshotPath);
    const expected = currentIdentity();
    if (before.isSymbolicLink() || !before.isFile()) throw new Error("SUBMISSION_SNAPSHOT_PATH_UNSAFE");
    if (mode(before.mode) !== REQUIRED_FILE_MODE || before.uid !== expected.uid || before.gid !== expected.gid) {
      throw new Error("SUBMISSION_SNAPSHOT_INSECURE");
    }
    if (before.size > MAX_SNAPSHOT_BYTES) throw new Error("SUBMISSION_SNAPSHOT_TOO_LARGE");
    const handle = await open(this.#descriptor.snapshotPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || identity(before) !== identity(opened)) throw new Error("SUBMISSION_SNAPSHOT_CHANGED");
      const buffer = await handle.readFile();
      if (buffer.byteLength > MAX_SNAPSHOT_BYTES) throw new Error("SUBMISSION_SNAPSHOT_TOO_LARGE");
      const after = await stat(this.#descriptor.snapshotPath);
      if (identity(opened) !== identity(after)) throw new Error("SUBMISSION_SNAPSHOT_CHANGED");
      let candidate: unknown;
      try {
        candidate = parseStrictJson(buffer.toString("utf8"));
      } catch {
        throw new Error("SUBMISSION_SNAPSHOT_INVALID");
      }
      const validator = await this.#validator;
      if (!validator(candidate)) throw new Error("SUBMISSION_SNAPSHOT_INVALID");
      return candidate;
    } finally {
      await handle.close();
    }
  }

  async observe(request: SubmissionTrackerSnapshotObservationRequest): Promise<Observation<SubmissionData>> {
    if (request.source !== "SUBMISSION_TRACKER_LOCAL_SNAPSHOT") {
      throw new TypeError("Submission observation source is not approved.");
    }
    const snapshot = await this.#readSnapshot();
    const asOfMilliseconds = Date.parse(request.asOf);
    const generatedMilliseconds = Date.parse(snapshot.generated_at);
    const observedMilliseconds = Date.parse(snapshot.observed_at);
    if (
      !Number.isFinite(asOfMilliseconds) ||
      !Number.isFinite(generatedMilliseconds) ||
      !Number.isFinite(observedMilliseconds) ||
      generatedMilliseconds > asOfMilliseconds + request.futureToleranceMs ||
      observedMilliseconds > asOfMilliseconds + request.futureToleranceMs
    ) throw new Error("SUBMISSION_SNAPSHOT_INVALID");
    const semantics = validateSubmissionSnapshotSemantics(snapshot, {
      asOf: snapshot.generated_at,
      futureToleranceMs: 0,
    });
    if (!semantics.valid) throw new Error("SUBMISSION_SNAPSHOT_INVALID");
    const provenance = { source: request.source, observedAt: snapshot.observed_at, fetchedAt: request.asOf } as const;
    if (snapshot.snapshot_status === "UNKNOWN") {
      return createObservation<SubmissionData>({
        availability: "UNKNOWN",
        reviewStatus: snapshot.review_status,
        completeness: "UNKNOWN",
        freshness: "UNKNOWN",
        provenance,
        confidence: { level: "NONE", reasons: ["Snapshot declared UNKNOWN."] },
        current: null,
        error: null,
        lastKnownGood: null,
      });
    }
    if (snapshot.data === null) throw new Error("SUBMISSION_SNAPSHOT_INVALID");
    const freshness = calculateFreshness({
      observedAt: snapshot.observed_at,
      asOf: request.asOf,
      staleAfterMs: request.staleAfterMs,
      expiredAfterMs: request.expiredAfterMs,
    });
    if (snapshot.snapshot_status === "EMPTY") {
      return createObservation({
        availability: "EMPTY",
        reviewStatus: snapshot.review_status,
        completeness: "EMPTY",
        freshness,
        provenance,
        confidence: { level: "HIGH", reasons: ["Canonical empty snapshot validated."] },
        current: snapshot.data,
        error: null,
        lastKnownGood: null,
      });
    }
    const detailsDisabled =
      snapshot.data.paper_details.items.length === 0 &&
      snapshot.data.paper_details.included_count === 0 &&
      snapshot.data.paper_details.total_count === snapshot.data.summary.total_count &&
      snapshot.data.paper_details.truncated;
    return createObservation({
      availability: freshness === "FRESH" ? "AVAILABLE" : "STALE",
      reviewStatus: snapshot.review_status,
      completeness: detailsDisabled ? "PARTIAL" : "COMPLETE",
      freshness,
      provenance,
      confidence: {
        level: detailsDisabled ? "MEDIUM" : "HIGH",
        reasons: [detailsDisabled ? "Canonical aggregate snapshot validated; paper detail export disabled." : "Canonical snapshot validated."],
      },
      current: snapshot.data,
      error: null,
      lastKnownGood: null,
    });
  }
}
