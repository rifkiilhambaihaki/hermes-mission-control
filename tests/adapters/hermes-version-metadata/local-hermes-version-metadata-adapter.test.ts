import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DIRECT_URL_MAX_BYTES,
  HERMES_SOURCE_MAX_BYTES,
  METADATA_MAX_BYTES,
  LocalHermesInstallationDescriptor,
  LocalHermesVersionMetadataAdapter,
  localVersionMetadataResultToObservation,
  parserCompatibilityAuthorityFromLocalMetadata,
} from "../../../src/adapters/hermes-version-metadata/index.js";

interface FixtureOptions {
  readonly metadata?: string | null;
  readonly directUrl?: string | null;
  readonly source?: string | null;
  readonly metadataDirectory?: string;
}

const roots: string[] = [];

async function fixture(options: FixtureOptions = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "mission-control-version-metadata-"));
  roots.push(root);
  const sitePackagesRoot = resolve(root, "approved-site-packages");
  const metadataDirectory = options.metadataDirectory ?? resolve(sitePackagesRoot, "hermes_agent-0.16.0.dist-info");
  const sourceRoot = resolve(root, "approved-source");
  await mkdir(sitePackagesRoot, { recursive: true });
  await mkdir(metadataDirectory, { recursive: true });
  await mkdir(resolve(sourceRoot, "hermes_cli"), { recursive: true });

  if (options.metadata !== null) {
    await writeFile(
      resolve(metadataDirectory, "METADATA"),
      options.metadata ?? "Metadata-Version: 2.4\nName: hermes-agent\nVersion: 0.16.0\n",
      "utf8",
    );
  }
  if (options.directUrl !== undefined && options.directUrl !== null) {
    await writeFile(resolve(metadataDirectory, "direct_url.json"), options.directUrl, "utf8");
  }
  if (options.source !== null) {
    await writeFile(
      resolve(sourceRoot, "hermes_cli", "__init__.py"),
      options.source ?? '__version__ = "0.16.0"\n',
      "utf8",
    );
  }

  const descriptor = LocalHermesInstallationDescriptor.fromApprovedServerConfiguration({
    sitePackagesRoot,
    distributionMetadataDirectory: metadataDirectory,
    editableSourceRoot: sourceRoot,
  });
  return {
    root,
    sitePackagesRoot,
    metadataDirectory,
    sourceRoot,
    adapter: new LocalHermesVersionMetadataAdapter(descriptor),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("LocalHermesVersionMetadataAdapter", () => {
  it("establishes a supported non-editable installed distribution", async () => {
    const { adapter } = await fixture();
    await expect(adapter.read()).resolves.toEqual({
      availability: "AVAILABLE",
      reviewStatus: "NONE",
      current: {
        version: "0.16.0",
        installationKind: "INSTALLED",
        authority: "INSTALLED_DISTRIBUTION",
        consistencyStatus: "NOT_REQUIRED",
        compatibilityStatus: "SUPPORTED",
        adapterVersion: "1.0.0",
      },
      error: null,
    });
  });

  it("establishes a supported editable install only when metadata and source agree", async () => {
    const { adapter } = await fixture({
      directUrl: JSON.stringify({ url: "file:///synthetic/private/source", dir_info: { editable: true } }),
    });
    await expect(adapter.read()).resolves.toMatchObject({
      availability: "AVAILABLE",
      reviewStatus: "NONE",
      current: {
        version: "0.16.0",
        installationKind: "EDITABLE",
        authority: "INSTALLED_DISTRIBUTION_CONFIRMED_BY_RUNTIME_SOURCE",
        consistencyStatus: "MATCHED",
        compatibilityStatus: "SUPPORTED",
      },
    });
  });

  it("requires review and withholds current data for editable version mismatch", async () => {
    const { adapter } = await fixture({
      directUrl: JSON.stringify({ url: "file:///synthetic/private/source", dir_info: { editable: true } }),
      source: '__version__ = "0.17.0"\n',
    });
    await expect(adapter.read()).resolves.toEqual({
      availability: "UNKNOWN",
      reviewStatus: "REVIEW_REQUIRED",
      current: null,
      error: { code: "VERSION_METADATA_MISMATCH", retryable: false },
    });
  });

  it("keeps an established unsupported version available without granting parser compatibility", async () => {
    const { adapter } = await fixture({
      metadata: "Metadata-Version: 2.4\nName: hermes-agent\nVersion: 0.17.0\n",
    });
    const result = await adapter.read();
    expect(result).toMatchObject({
      availability: "AVAILABLE",
      current: { version: "0.17.0", compatibilityStatus: "UNSUPPORTED" },
    });
    expect(parserCompatibilityAuthorityFromLocalMetadata(result)).toBeNull();
  });

  it("maps missing METADATA to UNKNOWN rather than transport failure", async () => {
    const { adapter } = await fixture({ metadata: null });
    await expect(adapter.read()).resolves.toEqual({
      availability: "UNKNOWN",
      reviewStatus: "NONE",
      current: null,
      error: { code: "METADATA_FILE_MISSING", retryable: false },
    });
  });

  it.each([
    ["malformed headers", "not metadata", "INVALID_DISTRIBUTION_METADATA"],
    ["malformed header line", "Name: hermes-agent\nMalformed header\nVersion: 0.16.0\n", "INVALID_DISTRIBUTION_METADATA"],
    ["whitespace before Name separator", "Name : hermes-agent\nVersion: 0.16.0\n", "INVALID_DISTRIBUTION_METADATA"],
    ["tab before Version separator", "Name: hermes-agent\nVersion\t: 0.16.0\n", "INVALID_DISTRIBUTION_METADATA"],
    ["wrong package", "Name: other-package\nVersion: 0.16.0\n", "WRONG_PACKAGE_NAME"],
    ["duplicate name", "Name: hermes-agent\nName: hermes-agent\nVersion: 0.16.0\n", "DUPLICATE_METADATA_FIELD"],
    ["duplicate version", "Name: hermes-agent\nVersion: 0.16.0\nVersion: 0.16.0\n", "DUPLICATE_METADATA_FIELD"],
    ["malformed version", "Name: hermes-agent\nVersion: 01.16.0\n", "INVALID_SEMANTIC_VERSION"],
    ["Unicode authority version", "Name: hermes-agent\nVersion: 0.16.β\n", "INVALID_DISTRIBUTION_METADATA"],
    ["control in unrelated header", "Name: hermes-agent\nVersion: 0.16.0\nSummary: synthetic\u0001summary\n", "INVALID_DISTRIBUTION_METADATA"],
    ["bare carriage return in unrelated header", "Name: hermes-agent\nVersion: 0.16.0\nSummary: synthetic\rsummary\n", "INVALID_DISTRIBUTION_METADATA"],
    ["control in description", "Name: hermes-agent\nVersion: 0.16.0\n\nSynthetic\u0001description\n", "INVALID_DISTRIBUTION_METADATA"],
    ["bare carriage return in description", "Name: hermes-agent\nVersion: 0.16.0\n\nSynthetic\rdescription\n", "INVALID_DISTRIBUTION_METADATA"],
    ["control in Name", "Name: hermes\u0001-agent\nVersion: 0.16.0\n", "INVALID_DISTRIBUTION_METADATA"],
    ["control in Version", "Name: hermes-agent\nVersion: 0.16.0\u0001\n", "INVALID_DISTRIBUTION_METADATA"],
    ["folded version header", "Name: hermes-agent\nVersion: 0.16.0\n Version: 9.9.9\n", "INVALID_DISTRIBUTION_METADATA"],
  ] as const)("rejects %s", async (_label, metadata, errorCode) => {
    const { adapter } = await fixture({ metadata });
    await expect(adapter.read()).resolves.toMatchObject({
      availability: "UNKNOWN",
      current: null,
      error: { code: errorCode },
    });
  });

  it.each([
    ["ASCII-only metadata", "Metadata-Version: 2.4\nName: hermes-agent\nVersion: 0.16.0\n"],
    ["Unicode Summary", "Metadata-Version: 2.4\nName: hermes-agent\nVersion: 0.16.0\nSummary: résumé synthétique\n"],
    ["Unicode description", "Metadata-Version: 2.4\nName: hermes-agent\nVersion: 0.16.0\n\nDokumentasi résumé 日本語\n"],
    ["Unicode unrelated header", "Metadata-Version: 2.4\nName: hermes-agent\nVersion: 0.16.0\nX-Synthetic-Label: naïve café\n"],
    ["printable RFC-style unrelated field name", "Metadata-Version: 2.4\nName: hermes-agent\nVersion: 0.16.0\nX-Synthetic!Label: synthetic\n"],
    ["repeated Requires-Dist", "Metadata-Version: 2.4\nName: hermes-agent\nVersion: 0.16.0\nRequires-Dist: synthetic-one\nRequires-Dist: synthetic-two\n"],
    ["repeated Provides-Extra", "Metadata-Version: 2.4\nName: hermes-agent\nVersion: 0.16.0\nProvides-Extra: synthetic-one\nProvides-Extra: synthetic-two\n"],
  ] as const)("accepts structurally valid %s", async (_label, metadata) => {
    const { adapter } = await fixture({ metadata });
    await expect(adapter.read()).resolves.toMatchObject({
      availability: "AVAILABLE",
      current: { version: "0.16.0" },
      error: null,
    });
  });

  it("projects only Name and Version authority without leaking unrelated metadata", async () => {
    const canaries = [
      "SUMMARY-PRIVACY-CANARY",
      "DEPENDENCY-PRIVACY-CANARY",
      "AUTHOR-PRIVACY-CANARY@example.invalid",
      "https://example.invalid/URL-PRIVACY-CANARY",
      "DESCRIPTION-PRIVACY-CANARY",
    ];
    const { adapter } = await fixture({
      metadata: [
        "Metadata-Version: 2.4",
        "Name: hermes-agent",
        "Version: 0.16.0",
        `Summary: résumé ${canaries[0]}`,
        `Requires-Dist: ${canaries[1]}`,
        `Author-email: ${canaries[2]}`,
        `Project-URL: Synthetic, ${canaries[3]}`,
        "",
        canaries[4],
        "",
      ].join("\n"),
    });
    const result = await adapter.read();
    const observation = localVersionMetadataResultToObservation(result, {
      source: "LOCAL_HERMES_VERSION_METADATA",
      observedAt: "2027-01-01T00:00:00.000Z",
      fetchedAt: "2027-01-01T00:00:00.000Z",
    });
    const serialized = JSON.stringify({ result, observation });
    expect(result).toMatchObject({ availability: "AVAILABLE", current: { version: "0.16.0" } });
    for (const canary of canaries) expect(serialized).not.toContain(canary);
  });

  it("does not leak unrelated metadata through a rejected authority result", async () => {
    const canaries = [
      "WRONG-NAME-PRIVACY-CANARY",
      "SUMMARY-ERROR-PRIVACY-CANARY",
      "DEPENDENCY-ERROR-PRIVACY-CANARY",
      "DESCRIPTION-ERROR-PRIVACY-CANARY",
    ];
    const { adapter } = await fixture({
      metadata: [
        "Metadata-Version: 2.4",
        `Name: ${canaries[0]}`,
        "Version: 0.16.0",
        `Summary: ${canaries[1]}`,
        `Requires-Dist: ${canaries[2]}`,
        "",
        canaries[3],
        "",
      ].join("\n"),
    });
    const serialized = JSON.stringify(await adapter.read());
    expect(serialized).toContain("WRONG_PACKAGE_NAME");
    for (const canary of canaries) expect(serialized).not.toContain(canary);
  });

  it("ignores Name and Version-looking lines in the METADATA body", async () => {
    const { adapter } = await fixture({
      metadata: "Name: hermes-agent\nVersion: 0.16.0\n\nName: documentation example\nVersion: not-a-header\n",
    });
    await expect(adapter.read()).resolves.toMatchObject({
      availability: "AVAILABLE",
      current: { version: "0.16.0" },
    });
  });

  it("rejects malformed direct_url.json without exposing it", async () => {
    const { adapter } = await fixture({ directUrl: '{"url":"file:///private/canary",' });
    const result = await adapter.read();
    expect(result).toMatchObject({
      availability: "UNKNOWN",
      current: null,
      error: { code: "MALFORMED_EDITABLE_PROVENANCE" },
    });
    expect(JSON.stringify(result)).not.toContain("private/canary");
  });

  it("rejects direct_url.json without the required URL field", async () => {
    const { adapter } = await fixture({
      directUrl: JSON.stringify({ dir_info: { editable: true } }),
    });
    await expect(adapter.read()).resolves.toMatchObject({
      availability: "UNKNOWN",
      error: { code: "MALFORMED_EDITABLE_PROVENANCE" },
    });
  });

  it.each([
    ["missing provenance category", { url: "file:///synthetic/source" }],
    ["conflicting provenance categories", {
      url: "file:///synthetic/source",
      dir_info: { editable: true },
      archive_info: {},
    }],
    ["invalid provenance category shape", {
      url: "file:///synthetic/source",
      dir_info: "editable",
    }],
    ["malformed VCS provenance", {
      url: "https://example.invalid/source",
      vcs_info: {},
    }],
    ["invalid URL syntax", {
      url: "not a URL",
      dir_info: { editable: true },
    }],
    ["unknown top-level field", {
      url: "file:///synthetic/source",
      dir_info: { editable: true },
      unexpected: true,
    }],
  ])("rejects direct_url.json with %s", async (_label, provenance) => {
    const { adapter } = await fixture({ directUrl: JSON.stringify(provenance) });
    await expect(adapter.read()).resolves.toMatchObject({
      availability: "UNKNOWN",
      error: { code: "MALFORMED_EDITABLE_PROVENANCE" },
    });
  });

  it("accepts a valid non-editable archive provenance without exposing its URL", async () => {
    const { adapter } = await fixture({
      directUrl: JSON.stringify({
        url: "file:///private/archive-canary",
        archive_info: {},
      }),
    });
    const result = await adapter.read();
    expect(result).toMatchObject({
      availability: "AVAILABLE",
      current: { installationKind: "INSTALLED" },
    });
    expect(JSON.stringify(result)).not.toContain("archive-canary");
  });

  it("accepts valid non-editable VCS provenance without exposing it", async () => {
    const { adapter } = await fixture({
      directUrl: JSON.stringify({
        url: "https://example.invalid/private-vcs-canary",
        vcs_info: { vcs: "git", commit_id: "synthetic-commit" },
      }),
    });
    const result = await adapter.read();
    expect(result).toMatchObject({
      availability: "AVAILABLE",
      current: { installationKind: "INSTALLED" },
    });
    expect(JSON.stringify(result)).not.toContain("private-vcs-canary");
    expect(JSON.stringify(result)).not.toContain("synthetic-commit");
  });

  it("rejects duplicate direct_url.json keys", async () => {
    const { adapter } = await fixture({
      directUrl: '{"dir_info":{"editable":true,"editable":false}}',
    });
    await expect(adapter.read()).resolves.toMatchObject({
      availability: "UNKNOWN",
      error: { code: "MALFORMED_EDITABLE_PROVENANCE" },
    });
  });

  it("requires runtime source version for editable provenance", async () => {
    const { adapter } = await fixture({
      directUrl: JSON.stringify({ dir_info: { editable: true }, url: "file:///not-exported" }),
      source: null,
    });
    await expect(adapter.read()).resolves.toMatchObject({
      availability: "UNKNOWN",
      current: null,
      error: { code: "RUNTIME_SOURCE_FILE_MISSING" },
    });
  });

  it.each([
    ["multiple declarations", '__version__ = "0.16.0"\n__version__ = "0.16.0"\n', "MULTIPLE_RUNTIME_VERSION_DECLARATIONS"],
    ["expression", '__version__ = make_version("0.16.0")\n', "INVALID_RUNTIME_VERSION_DECLARATION"],
    ["literal plus expression", '__version__ = "0.16.0"\n__version__ = make_version()\n', "INVALID_RUNTIME_VERSION_DECLARATION"],
    ["Unicode version", '__version__ = "0.16.β"\n', "INVALID_RUNTIME_VERSION_DECLARATION"],
    ["declaration text only in multiline string", '"""\n__version__ = "0.16.0"\n"""\n', "INVALID_RUNTIME_VERSION_DECLARATION"],
  ] as const)("rejects runtime source %s", async (_label, source, errorCode) => {
    const { adapter } = await fixture({
      directUrl: JSON.stringify({ url: "file:///synthetic/source", dir_info: { editable: true } }),
      source,
    });
    await expect(adapter.read()).resolves.toMatchObject({
      availability: "UNKNOWN",
      current: null,
      error: { code: errorCode },
    });
  });

  it("accepts one exact declaration after a closed module docstring", async () => {
    const { adapter } = await fixture({
      directUrl: JSON.stringify({
        url: "file:///synthetic/source",
        dir_info: { editable: true },
      }),
      source: '"""Synthetic module documentation."""\n__version__ = "0.16.0"\n',
    });
    await expect(adapter.read()).resolves.toMatchObject({
      availability: "AVAILABLE",
      current: { version: "0.16.0", installationKind: "EDITABLE" },
    });
  });

  it("rejects a metadata symlink escape", async () => {
    const setup = await fixture({ metadata: null });
    const outside = resolve(setup.root, "outside-metadata");
    await writeFile(outside, "Name: hermes-agent\nVersion: 0.16.0\n", "utf8");
    await symlink(outside, resolve(setup.metadataDirectory, "METADATA"));
    await expect(setup.adapter.read()).resolves.toMatchObject({
      availability: "UNKNOWN",
      current: null,
      error: { code: "SYMLINK_REJECTED" },
    });
  });

  it("rejects a descriptor path traversal outside the approved site-packages root", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "mission-control-version-traversal-"));
    roots.push(root);
    const sitePackagesRoot = resolve(root, "site-packages");
    const outsideMetadata = resolve(root, "outside", "hermes_agent-0.16.0.dist-info");
    const sourceRoot = resolve(root, "source");
    await mkdir(sitePackagesRoot, { recursive: true });
    await mkdir(outsideMetadata, { recursive: true });
    await mkdir(sourceRoot, { recursive: true });
    const descriptor = LocalHermesInstallationDescriptor.fromApprovedServerConfiguration({
      sitePackagesRoot,
      distributionMetadataDirectory: resolve(sitePackagesRoot, "..", "outside", "hermes_agent-0.16.0.dist-info"),
      editableSourceRoot: sourceRoot,
    });
    await expect(new LocalHermesVersionMetadataAdapter(descriptor).read()).resolves.toMatchObject({
      availability: "UNKNOWN",
      current: null,
      error: { code: "PATH_BOUNDARY_VIOLATION" },
    });
  });

  it.each([
    ["METADATA", METADATA_MAX_BYTES + 1, "METADATA_FILE_TOO_LARGE"],
    ["direct_url.json", DIRECT_URL_MAX_BYTES + 1, "DIRECT_URL_FILE_TOO_LARGE"],
    ["__init__.py", HERMES_SOURCE_MAX_BYTES + 1, "RUNTIME_SOURCE_FILE_TOO_LARGE"],
  ] as const)("rejects oversized %s", async (file, size, errorCode) => {
    const editable = file !== "METADATA";
    const setup = await fixture({
      directUrl: editable ? JSON.stringify({ url: "file:///synthetic/source", dir_info: { editable: true } }) : null,
    });
    const target = file === "__init__.py"
      ? resolve(setup.sourceRoot, "hermes_cli", file)
      : resolve(setup.metadataDirectory, file);
    await writeFile(target, "x".repeat(size), "utf8");
    await expect(setup.adapter.read()).resolves.toMatchObject({
      availability: "UNKNOWN",
      current: null,
      error: { code: errorCode },
    });
  });

  it("never leaks approved paths, direct_url URL, or raw content", async () => {
    const rawCanary = "RAW-CONTENT-CANARY";
    const setup = await fixture({
      directUrl: JSON.stringify({
        url: "file:///home/synthetic-user/private-checkout",
        dir_info: { editable: true },
        canary: rawCanary,
      }),
    });
    const serialized = JSON.stringify(await setup.adapter.read());
    expect(serialized).not.toContain(setup.root);
    expect(serialized).not.toContain("private-checkout");
    expect(serialized).not.toContain(rawCanary);
    expect(serialized).not.toContain("METADATA");
    expect(serialized).not.toContain("__init__.py");
  });

  it("keeps descriptor paths opaque and rejects direct construction", async () => {
    const setup = await fixture();
    const descriptor = LocalHermesInstallationDescriptor.fromApprovedServerConfiguration({
      sitePackagesRoot: setup.sitePackagesRoot,
      distributionMetadataDirectory: setup.metadataDirectory,
      editableSourceRoot: setup.sourceRoot,
    });
    expect(JSON.stringify(descriptor)).toBe("{}");
    expect(() => Reflect.construct(LocalHermesInstallationDescriptor, [Symbol("unapproved"), {}])).toThrow(
      "Invalid installation descriptor construction",
    );
  });

  it("maps sanitized adapter results into pure observations", async () => {
    const { adapter } = await fixture();
    const result = await adapter.read();
    const observation = localVersionMetadataResultToObservation(result, {
      source: "LOCAL_HERMES_VERSION_METADATA",
      observedAt: "2027-01-01T00:00:00.000Z",
      fetchedAt: "2027-01-01T00:00:00.000Z",
    });
    expect(observation).toMatchObject({
      availability: "AVAILABLE",
      reviewStatus: "NONE",
      current: { version: "0.16.0", compatibilityStatus: "SUPPORTED" },
      error: null,
    });
    expect(parserCompatibilityAuthorityFromLocalMetadata(result)).toMatchObject({ version: "0.16.0" });
  });

  it("does not mint compatibility authority from historical CLI parser-shaped data", () => {
    const historicalCliResult = {
      ok: true,
      commandId: "HERMES_VERSION",
      normalizedData: { version: "0.16.0" },
    };
    expect(parserCompatibilityAuthorityFromLocalMetadata(historicalCliResult as never)).toBeNull();
  });

  it("maps read transport failure separately from invalid metadata", () => {
    const observation = localVersionMetadataResultToObservation(
      {
        availability: "UNAVAILABLE",
        reviewStatus: "NONE",
        current: null,
        error: { code: "METADATA_FILE_UNAVAILABLE", retryable: true },
      },
      {
        source: "LOCAL_HERMES_VERSION_METADATA",
        observedAt: "2027-01-01T00:00:00.000Z",
        fetchedAt: "2027-01-01T00:00:00.000Z",
      },
    );
    expect(observation).toMatchObject({
      availability: "UNAVAILABLE",
      current: null,
      provenance: null,
      error: { code: "METADATA_FILE_UNAVAILABLE", retryable: true },
    });
  });
});
