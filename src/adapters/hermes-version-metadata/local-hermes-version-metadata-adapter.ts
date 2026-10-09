import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import { parseStrictJson } from "./strict-json.js";

export const LOCAL_HERMES_VERSION_METADATA_ADAPTER_VERSION = "1.0.0" as const;
export const SUPPORTED_LOCAL_HERMES_VERSION = "0.16.0" as const;
export const METADATA_MAX_BYTES = 64 * 1024;
export const DIRECT_URL_MAX_BYTES = 16 * 1024;
export const HERMES_SOURCE_MAX_BYTES = 64 * 1024;

export type InstallationKind = "EDITABLE" | "INSTALLED";
export type VersionAuthority =
  | "INSTALLED_DISTRIBUTION"
  | "INSTALLED_DISTRIBUTION_CONFIRMED_BY_RUNTIME_SOURCE";
export type ConsistencyStatus = "MATCHED" | "NOT_REQUIRED";
export type CompatibilityStatus = "SUPPORTED" | "UNSUPPORTED";

export type LocalVersionMetadataErrorCode =
  | "PATH_BOUNDARY_VIOLATION"
  | "SYMLINK_REJECTED"
  | "NOT_REGULAR_FILE"
  | "METADATA_FILE_MISSING"
  | "METADATA_FILE_UNAVAILABLE"
  | "METADATA_FILE_TOO_LARGE"
  | "INVALID_DISTRIBUTION_METADATA"
  | "WRONG_PACKAGE_NAME"
  | "DUPLICATE_METADATA_FIELD"
  | "INVALID_SEMANTIC_VERSION"
  | "DIRECT_URL_FILE_UNAVAILABLE"
  | "DIRECT_URL_FILE_TOO_LARGE"
  | "MALFORMED_EDITABLE_PROVENANCE"
  | "RUNTIME_SOURCE_FILE_MISSING"
  | "RUNTIME_SOURCE_FILE_UNAVAILABLE"
  | "RUNTIME_SOURCE_FILE_TOO_LARGE"
  | "INVALID_RUNTIME_VERSION_DECLARATION"
  | "MULTIPLE_RUNTIME_VERSION_DECLARATIONS"
  | "VERSION_METADATA_MISMATCH";

export interface LocalHermesVersionMetadata {
  readonly version: string;
  readonly installationKind: InstallationKind;
  readonly authority: VersionAuthority;
  readonly consistencyStatus: ConsistencyStatus;
  readonly compatibilityStatus: CompatibilityStatus;
  readonly adapterVersion: typeof LOCAL_HERMES_VERSION_METADATA_ADAPTER_VERSION;
}

export interface AvailableLocalVersionMetadataResult {
  readonly availability: "AVAILABLE";
  readonly reviewStatus: "NONE";
  readonly current: LocalHermesVersionMetadata;
  readonly error: null;
}

export interface FailedLocalVersionMetadataResult {
  readonly availability: "UNKNOWN" | "UNAVAILABLE";
  readonly reviewStatus: "NONE" | "REVIEW_REQUIRED";
  readonly current: null;
  readonly error: {
    readonly code: LocalVersionMetadataErrorCode;
    readonly retryable: boolean;
  };
}

export type LocalVersionMetadataResult =
  | AvailableLocalVersionMetadataResult
  | FailedLocalVersionMetadataResult;

export interface ApprovedServerHermesInstallationConfiguration {
  readonly sitePackagesRoot: string;
  readonly distributionMetadataDirectory: string;
  readonly editableSourceRoot: string;
}

interface InstallationPaths {
  readonly sitePackagesRoot: string;
  readonly distributionMetadataDirectory: string;
  readonly editableSourceRoot: string;
}

const descriptorToken = Symbol("LocalHermesInstallationDescriptor");
const descriptorPaths = new WeakMap<LocalHermesInstallationDescriptor, InstallationPaths>();
const adapterIssuedAvailableResults = new WeakSet<object>();

export class LocalHermesInstallationDescriptor {
  private constructor(
    token: symbol,
    configuration: ApprovedServerHermesInstallationConfiguration,
  ) {
    if (token !== descriptorToken) throw new TypeError("Invalid installation descriptor construction.");
    descriptorPaths.set(this, Object.freeze({ ...configuration }));
    Object.freeze(this);
  }

  static fromApprovedServerConfiguration(
    configuration: ApprovedServerHermesInstallationConfiguration,
  ): LocalHermesInstallationDescriptor {
    return new LocalHermesInstallationDescriptor(descriptorToken, configuration);
  }
}

class AdapterFailure extends Error {
  readonly code: LocalVersionMetadataErrorCode;
  readonly availability: "UNKNOWN" | "UNAVAILABLE";
  readonly reviewStatus: "NONE" | "REVIEW_REQUIRED";
  readonly retryable: boolean;

  constructor(
    code: LocalVersionMetadataErrorCode,
    options: {
      readonly availability?: "UNKNOWN" | "UNAVAILABLE";
      readonly reviewStatus?: "NONE" | "REVIEW_REQUIRED";
      readonly retryable?: boolean;
    } = {},
  ) {
    super(code);
    this.code = code;
    this.availability = options.availability ?? "UNKNOWN";
    this.reviewStatus = options.reviewStatus ?? "NONE";
    this.retryable = options.retryable ?? false;
  }
}

function failedResult(failure: AdapterFailure): FailedLocalVersionMetadataResult {
  return Object.freeze({
    availability: failure.availability,
    reviewStatus: failure.reviewStatus,
    current: null,
    error: Object.freeze({ code: failure.code, retryable: failure.retryable }),
  });
}

function availableResult(current: LocalHermesVersionMetadata): AvailableLocalVersionMetadataResult {
  const result = Object.freeze({
    availability: "AVAILABLE" as const,
    reviewStatus: "NONE" as const,
    current: Object.freeze(current),
    error: null,
  });
  adapterIssuedAvailableResults.add(result);
  return result;
}

export function isAdapterIssuedAvailableLocalVersionMetadataResult(
  result: LocalVersionMetadataResult,
): result is AvailableLocalVersionMetadataResult {
  return typeof result === "object" && result !== null && adapterIssuedAvailableResults.has(result);
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

async function assertDirectoryWithoutSymlink(path: string): Promise<void> {
  try {
    const status = await lstat(path);
    if (status.isSymbolicLink()) throw new AdapterFailure("SYMLINK_REJECTED");
    if (!status.isDirectory()) throw new AdapterFailure("PATH_BOUNDARY_VIOLATION");
  } catch (error) {
    if (error instanceof AdapterFailure) throw error;
    throw new AdapterFailure("PATH_BOUNDARY_VIOLATION");
  }
}

async function readBoundedApprovedFile(options: {
  readonly boundaryRoot: string;
  readonly file: string;
  readonly maximumBytes: number;
  readonly missingCode: LocalVersionMetadataErrorCode;
  readonly unavailableCode: LocalVersionMetadataErrorCode;
  readonly tooLargeCode: LocalVersionMetadataErrorCode;
  readonly optional?: boolean;
}): Promise<string | null> {
  const lexicalRoot = resolve(options.boundaryRoot);
  const lexicalFile = resolve(options.file);
  if (!isWithin(lexicalRoot, lexicalFile)) throw new AdapterFailure("PATH_BOUNDARY_VIOLATION");

  await assertDirectoryWithoutSymlink(lexicalRoot);
  const pathFromRoot = relative(lexicalRoot, lexicalFile).split(/[\\/]/).filter(Boolean);
  let cursor = lexicalRoot;
  for (const component of pathFromRoot.slice(0, -1)) {
    cursor = resolve(cursor, component);
    await assertDirectoryWithoutSymlink(cursor);
  }

  let fileStatus;
  try {
    fileStatus = await lstat(lexicalFile);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      if (options.optional === true) return null;
      throw new AdapterFailure(options.missingCode);
    }
    throw new AdapterFailure(options.unavailableCode, {
      availability: "UNAVAILABLE",
      retryable: true,
    });
  }
  if (fileStatus.isSymbolicLink()) throw new AdapterFailure("SYMLINK_REJECTED");
  if (!fileStatus.isFile()) throw new AdapterFailure("NOT_REGULAR_FILE");
  if (fileStatus.size > options.maximumBytes) throw new AdapterFailure(options.tooLargeCode);

  let realRoot: string;
  let realFile: string;
  try {
    [realRoot, realFile] = await Promise.all([realpath(lexicalRoot), realpath(lexicalFile)]);
  } catch {
    throw new AdapterFailure(options.unavailableCode, {
      availability: "UNAVAILABLE",
      retryable: true,
    });
  }
  if (!isWithin(realRoot, realFile)) throw new AdapterFailure("PATH_BOUNDARY_VIOLATION");

  let handle;
  try {
    handle = await open(lexicalFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedStatus = await handle.stat();
    if (!openedStatus.isFile()) throw new AdapterFailure("NOT_REGULAR_FILE");
    if (openedStatus.size > options.maximumBytes) throw new AdapterFailure(options.tooLargeCode);
    let openedRealPath: string;
    try {
      openedRealPath = await realpath(`/proc/self/fd/${handle.fd}`);
    } catch {
      throw new AdapterFailure(options.unavailableCode, {
        availability: "UNAVAILABLE",
        retryable: true,
      });
    }
    if (!isWithin(realRoot, openedRealPath) || openedRealPath !== realFile) {
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
      throw new AdapterFailure(
        options.missingCode === "METADATA_FILE_MISSING"
          ? "INVALID_DISTRIBUTION_METADATA"
          : options.missingCode === "RUNTIME_SOURCE_FILE_MISSING"
            ? "INVALID_RUNTIME_VERSION_DECLARATION"
            : "MALFORMED_EDITABLE_PROVENANCE",
      );
    }
  } catch (error) {
    if (error instanceof AdapterFailure) throw error;
    throw new AdapterFailure(options.unavailableCode, {
      availability: "UNAVAILABLE",
      retryable: true,
    });
  } finally {
    await handle?.close();
  }
}

const SEMANTIC_VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function isSemanticVersion(candidate: string): boolean {
  return SEMANTIC_VERSION_PATTERN.test(candidate);
}

function containsProhibitedControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    if (codeUnit === 0x09 || codeUnit === 0x0a) continue;
    if (codeUnit === 0x0d) {
      if (text.charCodeAt(index + 1) === 0x0a) continue;
      return true;
    }
    if (codeUnit < 0x20 || (codeUnit >= 0x7f && codeUnit <= 0x9f)) return true;
  }
  return false;
}

function isSafeAuthorityField(value: string): boolean {
  if (value.length === 0) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 0x20 || codePoint > 0x7e) return false;
  }
  return true;
}

function parseDistributionMetadata(text: string): string {
  const boundary = /\r?\n\r?\n/.exec(text);
  const headerSection = boundary === null ? text : text.slice(0, boundary.index);
  const descriptionBody = boundary === null
    ? ""
    : text.slice(boundary.index + boundary[0].length);
  if (
    containsProhibitedControlCharacter(headerSection) ||
    containsProhibitedControlCharacter(descriptionBody)
  ) {
    throw new AdapterFailure("INVALID_DISTRIBUTION_METADATA");
  }

  const names: string[] = [];
  const versions: string[] = [];
  for (const line of headerSection.split(/\r?\n/)) {
    if (line.length === 0) continue;
    if (/^[ \t]/.test(line)) throw new AdapterFailure("INVALID_DISTRIBUTION_METADATA");
    const separator = line.indexOf(":");
    if (separator <= 0) throw new AdapterFailure("INVALID_DISTRIBUTION_METADATA");
    const rawField = line.slice(0, separator);
    if (!/^[\x21-\x39\x3b-\x7e]+$/.test(rawField)) {
      throw new AdapterFailure("INVALID_DISTRIBUTION_METADATA");
    }
    const field = rawField.toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "name") {
      if (!isSafeAuthorityField(value)) throw new AdapterFailure("INVALID_DISTRIBUTION_METADATA");
      names.push(value);
    }
    if (field === "version") {
      if (!isSafeAuthorityField(value)) throw new AdapterFailure("INVALID_DISTRIBUTION_METADATA");
      versions.push(value);
    }
  }
  if (names.length > 1 || versions.length > 1) {
    throw new AdapterFailure("DUPLICATE_METADATA_FIELD");
  }
  if (names.length !== 1 || versions.length !== 1) {
    throw new AdapterFailure("INVALID_DISTRIBUTION_METADATA");
  }
  if (names[0] !== "hermes-agent") throw new AdapterFailure("WRONG_PACKAGE_NAME");
  const version = versions[0];
  if (version === undefined || !isSemanticVersion(version)) {
    throw new AdapterFailure("INVALID_SEMANTIC_VERSION");
  }
  return version;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

function parseEditableProvenance(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = parseStrictJson(text);
  } catch {
    throw new AdapterFailure("MALFORMED_EDITABLE_PROVENANCE");
  }
  if (!isRecord(parsed)) throw new AdapterFailure("MALFORMED_EDITABLE_PROVENANCE");
  const topLevelKeys = new Set(["url", "dir_info", "archive_info", "vcs_info", "subdirectory"]);
  if (!hasOnlyKeys(parsed, topLevelKeys)) {
    throw new AdapterFailure("MALFORMED_EDITABLE_PROVENANCE");
  }
  if (
    typeof parsed.url !== "string" ||
    /[\u0000-\u0020\u007f]/.test(parsed.url)
  ) {
    throw new AdapterFailure("MALFORMED_EDITABLE_PROVENANCE");
  }
  try {
    void new URL(parsed.url);
  } catch {
    throw new AdapterFailure("MALFORMED_EDITABLE_PROVENANCE");
  }
  if (
    parsed.subdirectory !== undefined &&
    (typeof parsed.subdirectory !== "string" || parsed.subdirectory.length === 0)
  ) {
    throw new AdapterFailure("MALFORMED_EDITABLE_PROVENANCE");
  }
  const provenanceCategories = ["dir_info", "archive_info", "vcs_info"].filter(
    (field) => parsed[field] !== undefined,
  );
  if (provenanceCategories.length !== 1) {
    throw new AdapterFailure("MALFORMED_EDITABLE_PROVENANCE");
  }
  const category = provenanceCategories[0];
  const categoryValue = category === undefined ? undefined : parsed[category];
  if (!isRecord(categoryValue)) throw new AdapterFailure("MALFORMED_EDITABLE_PROVENANCE");

  if (category === "dir_info") {
    if (!hasOnlyKeys(categoryValue, new Set(["editable"]))) {
      throw new AdapterFailure("MALFORMED_EDITABLE_PROVENANCE");
    }
    const editable = categoryValue.editable;
    if (editable === undefined) return false;
    if (typeof editable !== "boolean") throw new AdapterFailure("MALFORMED_EDITABLE_PROVENANCE");
    return editable;
  }

  if (category === "archive_info") {
    if (!hasOnlyKeys(categoryValue, new Set(["hash", "hashes"]))) {
      throw new AdapterFailure("MALFORMED_EDITABLE_PROVENANCE");
    }
    if (
      categoryValue.hash !== undefined &&
      (typeof categoryValue.hash !== "string" || categoryValue.hash.length === 0)
    ) {
      throw new AdapterFailure("MALFORMED_EDITABLE_PROVENANCE");
    }
    if (categoryValue.hashes !== undefined) {
      if (!isRecord(categoryValue.hashes)) {
        throw new AdapterFailure("MALFORMED_EDITABLE_PROVENANCE");
      }
      for (const [algorithm, digest] of Object.entries(categoryValue.hashes)) {
        if (algorithm.length === 0 || typeof digest !== "string" || digest.length === 0) {
          throw new AdapterFailure("MALFORMED_EDITABLE_PROVENANCE");
        }
      }
    }
    return false;
  }

  if (!hasOnlyKeys(categoryValue, new Set(["vcs", "requested_revision", "commit_id"]))) {
    throw new AdapterFailure("MALFORMED_EDITABLE_PROVENANCE");
  }
  if (
    typeof categoryValue.vcs !== "string" ||
    categoryValue.vcs.length === 0 ||
    typeof categoryValue.commit_id !== "string" ||
    categoryValue.commit_id.length === 0 ||
    (categoryValue.requested_revision !== undefined &&
      (typeof categoryValue.requested_revision !== "string" ||
        categoryValue.requested_revision.length === 0))
  ) {
    throw new AdapterFailure("MALFORMED_EDITABLE_PROVENANCE");
  }
  return false;
}

type TripleQuote = "'''" | "\"\"\"";

function tripleQuoteStateAfterLine(line: string, initialState: TripleQuote | null): TripleQuote | null {
  let state = initialState;
  let index = 0;
  while (index < line.length) {
    if (state !== null) {
      const closingIndex = line.indexOf(state, index);
      if (closingIndex < 0) return state;
      let backslashes = 0;
      for (let cursor = closingIndex - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
        backslashes += 1;
      }
      if (backslashes % 2 === 1) {
        index = closingIndex + state.length;
        continue;
      }
      index = closingIndex + state.length;
      state = null;
      continue;
    }

    if (line[index] === "#") return null;
    const triple = line.startsWith("'''", index)
      ? "'''"
      : line.startsWith("\"\"\"", index)
        ? "\"\"\""
        : null;
    if (triple !== null) {
      state = triple;
      index += triple.length;
      continue;
    }
    const quote = line[index];
    if (quote === "'" || quote === '"') {
      index += 1;
      while (index < line.length) {
        if (line[index] === "\\") {
          index += 2;
          continue;
        }
        if (line[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    index += 1;
  }
  return state;
}

function parseRuntimeSourceVersion(text: string): string {
  const declarations: string[] = [];
  const declarationPattern = /^__version__\s*=\s*(["'])([^"']+)\1\s*(?:#.*)?$/;
  let tripleQuoteState: TripleQuote | null = null;
  for (const line of text.split(/\r?\n/)) {
    const startsInsideTripleQuote = tripleQuoteState !== null;
    if (!startsInsideTripleQuote && /^__version__\b/.test(line)) {
      const match = declarationPattern.exec(line);
      if (match?.[2] === undefined) {
        throw new AdapterFailure("INVALID_RUNTIME_VERSION_DECLARATION");
      }
      declarations.push(match[2]);
    }
    tripleQuoteState = tripleQuoteStateAfterLine(line, tripleQuoteState);
  }
  if (tripleQuoteState !== null) throw new AdapterFailure("INVALID_RUNTIME_VERSION_DECLARATION");
  if (declarations.length > 1) {
    throw new AdapterFailure("MULTIPLE_RUNTIME_VERSION_DECLARATIONS");
  }
  const version = declarations[0];
  if (version === undefined || !isSemanticVersion(version)) {
    throw new AdapterFailure("INVALID_RUNTIME_VERSION_DECLARATION");
  }
  return version;
}

function validateDescriptorPaths(paths: InstallationPaths): void {
  const sitePackagesRoot = resolve(paths.sitePackagesRoot);
  const metadataDirectory = resolve(paths.distributionMetadataDirectory);
  if (dirname(metadataDirectory) !== sitePackagesRoot) {
    throw new AdapterFailure("PATH_BOUNDARY_VIOLATION");
  }
  if (!/^hermes_agent-[0-9A-Za-z.+!_-]+\.dist-info$/.test(basename(metadataDirectory))) {
    throw new AdapterFailure("PATH_BOUNDARY_VIOLATION");
  }
}

export class LocalHermesVersionMetadataAdapter {
  readonly #descriptor: LocalHermesInstallationDescriptor;

  constructor(descriptor: LocalHermesInstallationDescriptor) {
    if (!descriptorPaths.has(descriptor)) {
      throw new TypeError("An approved installation descriptor is required.");
    }
    this.#descriptor = descriptor;
  }

  async read(): Promise<LocalVersionMetadataResult> {
    const paths = descriptorPaths.get(this.#descriptor);
    if (paths === undefined) throw new TypeError("Invalid installation descriptor.");
    try {
      validateDescriptorPaths(paths);
      const metadataText = await readBoundedApprovedFile({
        boundaryRoot: paths.sitePackagesRoot,
        file: resolve(paths.distributionMetadataDirectory, "METADATA"),
        maximumBytes: METADATA_MAX_BYTES,
        missingCode: "METADATA_FILE_MISSING",
        unavailableCode: "METADATA_FILE_UNAVAILABLE",
        tooLargeCode: "METADATA_FILE_TOO_LARGE",
      });
      if (metadataText === null) throw new AdapterFailure("METADATA_FILE_MISSING");
      const distributionVersion = parseDistributionMetadata(metadataText);

      const directUrlText = await readBoundedApprovedFile({
        boundaryRoot: paths.sitePackagesRoot,
        file: resolve(paths.distributionMetadataDirectory, "direct_url.json"),
        maximumBytes: DIRECT_URL_MAX_BYTES,
        missingCode: "MALFORMED_EDITABLE_PROVENANCE",
        unavailableCode: "DIRECT_URL_FILE_UNAVAILABLE",
        tooLargeCode: "DIRECT_URL_FILE_TOO_LARGE",
        optional: true,
      });
      const editable = directUrlText === null ? false : parseEditableProvenance(directUrlText);

      if (editable) {
        const sourceText = await readBoundedApprovedFile({
          boundaryRoot: paths.editableSourceRoot,
          file: resolve(paths.editableSourceRoot, "hermes_cli", "__init__.py"),
          maximumBytes: HERMES_SOURCE_MAX_BYTES,
          missingCode: "RUNTIME_SOURCE_FILE_MISSING",
          unavailableCode: "RUNTIME_SOURCE_FILE_UNAVAILABLE",
          tooLargeCode: "RUNTIME_SOURCE_FILE_TOO_LARGE",
        });
        if (sourceText === null) throw new AdapterFailure("RUNTIME_SOURCE_FILE_MISSING");
        const runtimeVersion = parseRuntimeSourceVersion(sourceText);
        if (runtimeVersion !== distributionVersion) {
          throw new AdapterFailure("VERSION_METADATA_MISMATCH", {
            reviewStatus: "REVIEW_REQUIRED",
          });
        }
        return availableResult({
          version: distributionVersion,
          installationKind: "EDITABLE",
          authority: "INSTALLED_DISTRIBUTION_CONFIRMED_BY_RUNTIME_SOURCE",
          consistencyStatus: "MATCHED",
          compatibilityStatus:
            distributionVersion === SUPPORTED_LOCAL_HERMES_VERSION ? "SUPPORTED" : "UNSUPPORTED",
          adapterVersion: LOCAL_HERMES_VERSION_METADATA_ADAPTER_VERSION,
        });
      }

      return availableResult({
        version: distributionVersion,
        installationKind: "INSTALLED",
        authority: "INSTALLED_DISTRIBUTION",
        consistencyStatus: "NOT_REQUIRED",
        compatibilityStatus:
          distributionVersion === SUPPORTED_LOCAL_HERMES_VERSION ? "SUPPORTED" : "UNSUPPORTED",
        adapterVersion: LOCAL_HERMES_VERSION_METADATA_ADAPTER_VERSION,
      });
    } catch (error) {
      if (error instanceof AdapterFailure) return failedResult(error);
      return failedResult(
        new AdapterFailure("METADATA_FILE_UNAVAILABLE", {
          availability: "UNAVAILABLE",
          retryable: true,
        }),
      );
    }
  }
}
