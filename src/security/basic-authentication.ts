import { createHash, timingSafeEqual } from "node:crypto";
import { TextDecoder } from "node:util";

import { verifyPassword } from "./scrypt-password.js";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export interface BasicCredentials {
  readonly username: string;
  readonly password: string;
}

function decodeStrictBase64(value: string): Buffer {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error("Malformed Basic authorization value.");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error("Malformed Basic authorization value.");
  }
  return decoded;
}

export function parseBasicAuthorization(header: string | undefined): BasicCredentials | null {
  if (header === undefined) {
    return null;
  }
  const match = /^Basic ([A-Za-z0-9+/=]+)$/.exec(header);
  if (match?.[1] === undefined) {
    return null;
  }
  try {
    const decoded = utf8Decoder.decode(decodeStrictBase64(match[1]));
    const separator = decoded.indexOf(":");
    if (separator < 0) {
      return null;
    }
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export async function authenticateBasic(
  header: string | undefined,
  expectedUsername: string,
  encodedPasswordHash: string,
): Promise<boolean> {
  const credentials = parseBasicAuthorization(header);
  if (credentials === null) {
    return false;
  }
  const passwordMatches = await verifyPassword(credentials.password, encodedPasswordHash);
  const usernameMatches = constantTimeTextEqual(credentials.username, expectedUsername);
  return usernameMatches && passwordMatches;
}
