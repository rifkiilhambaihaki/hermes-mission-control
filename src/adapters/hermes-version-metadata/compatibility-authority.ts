import {
  isAdapterIssuedAvailableLocalVersionMetadataResult,
  type LocalVersionMetadataResult,
} from "./local-hermes-version-metadata-adapter.js";

const parserCompatibilityAuthorityBrand: unique symbol = Symbol("ParserCompatibilityAuthority");
const issuedParserCompatibilityAuthorities = new WeakSet<object>();

export interface ParserCompatibilityAuthority {
  readonly version: "0.16.0";
  readonly source: "LOCAL_HERMES_VERSION_METADATA";
  readonly [parserCompatibilityAuthorityBrand]: true;
}

export function parserCompatibilityAuthorityFromLocalMetadata(
  result: LocalVersionMetadataResult,
): ParserCompatibilityAuthority | null {
  if (
    !isAdapterIssuedAvailableLocalVersionMetadataResult(result) ||
    result.current.compatibilityStatus !== "SUPPORTED" ||
    result.current.version !== "0.16.0"
  ) {
    return null;
  }
  const authority = Object.freeze({
    version: "0.16.0" as const,
    source: "LOCAL_HERMES_VERSION_METADATA" as const,
    [parserCompatibilityAuthorityBrand]: true as const,
  });
  issuedParserCompatibilityAuthorities.add(authority);
  return authority;
}

export function isParserCompatibilityAuthority(
  value: ParserCompatibilityAuthority | null,
): value is ParserCompatibilityAuthority {
  return typeof value === "object" && value !== null && issuedParserCompatibilityAuthorities.has(value);
}
