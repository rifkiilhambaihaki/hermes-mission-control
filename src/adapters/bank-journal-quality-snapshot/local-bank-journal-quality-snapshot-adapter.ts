import { constants } from "node:fs";
import { lstat, open, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

import { validateBankJournalSnapshotSemantics } from "../../domain/contracts/semantic-validation.js";
import type { BankJournalData, BankJournalSnapshot } from "../../domain/contracts/snapshot-types.js";
import { calculateFreshness } from "../../domain/observation/freshness.js";
import { createObservation, type Observation } from "../../domain/observation/observation.js";
import { parseStrictJson } from "./strict-json.js";

const MAX_SNAPSHOT_BYTES = 262_144;
const REQUIRED_DIRECTORY_MODE = 0o700;
const REQUIRED_FILE_MODE = 0o600;
const BANK_SCHEMA_ID = "https://mission-control.local/schemas/bank_journal_quality.snapshot.schema.json";

export interface BankJournalQualitySnapshotObservationRequest {
  readonly source: "BANK_JOURNAL_QUALITY_LOCAL_SNAPSHOT";
  readonly asOf: string;
  readonly staleAfterMs: number;
  readonly expiredAfterMs: number;
  readonly futureToleranceMs: number;
}

export interface ApprovedBankJournalQualitySnapshotConfiguration {
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
  if (getuid === undefined || getgid === undefined) throw new Error("BANK_JOURNAL_SNAPSHOT_INSECURE");
  return { uid: getuid(), gid: getgid() };
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  const expected = currentIdentity();
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error("BANK_JOURNAL_SNAPSHOT_PATH_UNSAFE");
  if (mode(metadata.mode) !== REQUIRED_DIRECTORY_MODE || metadata.uid !== expected.uid || metadata.gid !== expected.gid) {
    throw new Error("BANK_JOURNAL_SNAPSHOT_INSECURE");
  }
  if (await realpath(path) !== resolve(path)) throw new Error("BANK_JOURNAL_SNAPSHOT_PATH_UNSAFE");
}

export class BankJournalQualitySnapshotDescriptor {
  readonly snapshotPath: string;
  readonly schemaRoot: string;

  private constructor(configuration: ApprovedBankJournalQualitySnapshotConfiguration) {
    this.snapshotPath = resolve(configuration.snapshotPath);
    this.schemaRoot = resolve(configuration.schemaRoot);
    Object.freeze(this);
  }

  static fromApprovedServerConfiguration(
    configuration: ApprovedBankJournalQualitySnapshotConfiguration,
  ): BankJournalQualitySnapshotDescriptor {
    if (!isAbsolute(configuration.snapshotPath) || !isAbsolute(configuration.schemaRoot)) {
      throw new TypeError("Bank Journal snapshot configuration must use absolute paths.");
    }
    if (basename(configuration.snapshotPath) !== "bank_journal_quality.snapshot.json") {
      throw new TypeError("Bank Journal snapshot filename is not approved.");
    }
    return new BankJournalQualitySnapshotDescriptor(configuration);
  }
}

async function compileValidator(schemaRoot: string): Promise<ValidateFunction<BankJournalSnapshot>> {
  const [commonText, bankText] = await Promise.all([
    readFile(resolve(schemaRoot, "common.snapshot.defs.schema.json"), "utf8"),
    readFile(resolve(schemaRoot, "bank_journal_quality.snapshot.schema.json"), "utf8"),
  ]);
  const common = parseStrictJson(commonText) as object;
  const bank = parseStrictJson(bankText) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const addFormats = addFormatsModule as unknown as (instance: Ajv2020) => void;
  addFormats(ajv);
  ajv.addSchema(common);
  ajv.addSchema(bank);
  const validator = ajv.getSchema<BankJournalSnapshot>(BANK_SCHEMA_ID);
  if (validator === undefined) throw new Error("BANK_JOURNAL_SCHEMA_UNAVAILABLE");
  return validator;
}

export class LocalBankJournalQualitySnapshotAdapter {
  readonly #descriptor: BankJournalQualitySnapshotDescriptor;
  readonly #validator: Promise<ValidateFunction<BankJournalSnapshot>>;

  constructor(descriptor: BankJournalQualitySnapshotDescriptor) {
    this.#descriptor = descriptor;
    this.#validator = compileValidator(descriptor.schemaRoot);
  }

  async #readSnapshot(): Promise<BankJournalSnapshot> {
    const snapshotDirectory = dirname(this.#descriptor.snapshotPath);
    await assertPrivateDirectory(dirname(snapshotDirectory));
    await assertPrivateDirectory(snapshotDirectory);
    const before = await lstat(this.#descriptor.snapshotPath);
    const expected = currentIdentity();
    if (before.isSymbolicLink() || !before.isFile()) throw new Error("BANK_JOURNAL_SNAPSHOT_PATH_UNSAFE");
    if (mode(before.mode) !== REQUIRED_FILE_MODE || before.uid !== expected.uid || before.gid !== expected.gid) {
      throw new Error("BANK_JOURNAL_SNAPSHOT_INSECURE");
    }
    if (before.size > MAX_SNAPSHOT_BYTES) throw new Error("BANK_JOURNAL_SNAPSHOT_TOO_LARGE");
    const handle = await open(this.#descriptor.snapshotPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || identity(before) !== identity(opened)) throw new Error("BANK_JOURNAL_SNAPSHOT_CHANGED");
      const buffer = await handle.readFile();
      if (buffer.byteLength > MAX_SNAPSHOT_BYTES) throw new Error("BANK_JOURNAL_SNAPSHOT_TOO_LARGE");
      const after = await stat(this.#descriptor.snapshotPath);
      if (identity(opened) !== identity(after)) throw new Error("BANK_JOURNAL_SNAPSHOT_CHANGED");
      let candidate: unknown;
      try {
        candidate = parseStrictJson(buffer.toString("utf8"));
      } catch {
        throw new Error("BANK_JOURNAL_SNAPSHOT_INVALID");
      }
      const validator = await this.#validator;
      if (!validator(candidate)) throw new Error("BANK_JOURNAL_SNAPSHOT_INVALID");
      return candidate;
    } finally {
      await handle.close();
    }
  }

  async observe(request: BankJournalQualitySnapshotObservationRequest): Promise<Observation<BankJournalData>> {
    if (request.source !== "BANK_JOURNAL_QUALITY_LOCAL_SNAPSHOT") {
      throw new TypeError("Bank Journal observation source is not approved.");
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
    ) throw new Error("BANK_JOURNAL_SNAPSHOT_INVALID");
    const semantics = validateBankJournalSnapshotSemantics(snapshot, {
      asOf: snapshot.generated_at,
      futureToleranceMs: 0,
    });
    if (!semantics.valid) throw new Error("BANK_JOURNAL_SNAPSHOT_INVALID");
    const provenance = { source: request.source, observedAt: snapshot.observed_at, fetchedAt: request.asOf } as const;
    if (snapshot.snapshot_status === "UNKNOWN") {
      return createObservation<BankJournalData>({
        availability: "UNKNOWN", reviewStatus: snapshot.review_status, completeness: "UNKNOWN", freshness: "UNKNOWN",
        provenance, confidence: { level: "NONE", reasons: ["Snapshot declared UNKNOWN."] }, current: null,
        error: null, lastKnownGood: null,
      });
    }
    if (snapshot.data === null) throw new Error("BANK_JOURNAL_SNAPSHOT_INVALID");
    const freshness = calculateFreshness({
      observedAt: snapshot.observed_at,
      asOf: request.asOf,
      staleAfterMs: request.staleAfterMs,
      expiredAfterMs: request.expiredAfterMs,
    });
    if (snapshot.snapshot_status === "EMPTY") {
      return createObservation({
        availability: "EMPTY", reviewStatus: snapshot.review_status, completeness: "EMPTY", freshness, provenance,
        confidence: { level: "HIGH", reasons: ["Canonical empty snapshot validated."] }, current: snapshot.data,
        error: null, lastKnownGood: null,
      });
    }
    const detailsDisabled =
      snapshot.data.issue_details.items.length === 0 &&
      snapshot.data.issue_details.included_count === 0 &&
      snapshot.data.issue_details.total_count === snapshot.data.summary.quality_issue_count &&
      snapshot.data.issue_details.truncated;
    return createObservation({
      availability: freshness === "FRESH" ? "AVAILABLE" : "STALE",
      reviewStatus: snapshot.review_status,
      completeness: detailsDisabled ? "PARTIAL" : "COMPLETE",
      freshness,
      provenance,
      confidence: {
        level: detailsDisabled ? "MEDIUM" : "HIGH",
        reasons: [detailsDisabled
          ? "Canonical Bank Journal quality aggregates validated; issue detail export disabled."
          : "Canonical Bank Journal quality snapshot validated."],
      },
      current: snapshot.data,
      error: null,
      lastKnownGood: null,
    });
  }
}
