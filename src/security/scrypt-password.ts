import {
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual as nodeTimingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

export const SCRYPT_POLICY = Object.freeze({
  algorithm: "scrypt",
  version: "v1",
  N: 32_768,
  r: 8,
  p: 1,
  saltBytes: 16,
  derivedKeyBytes: 32,
  estimatedMemoryBytes: 33_555_456,
  maxmemBytes: 67_108_864,
});

export interface ParsedPasswordHash {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly derivedKey: Buffer;
}

export interface ScryptPrimitives {
  readonly derive: (
    password: string,
    salt: Buffer,
    keyLength: number,
    options: ScryptOptions,
  ) => Promise<Buffer>;
  readonly timingSafeEqual: (left: NodeJS.ArrayBufferView, right: NodeJS.ArrayBufferView) => boolean;
}

function derive(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

const DEFAULT_PRIMITIVES: ScryptPrimitives = {
  derive,
  timingSafeEqual: nodeTimingSafeEqual,
};

function decodeBase64Url(value: string, expectedBytes: number, label: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label} encoding.`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== expectedBytes || decoded.toString("base64url") !== value) {
    throw new Error(`Invalid ${label} length or encoding.`);
  }
  return decoded;
}

function parseInteger(value: string, label: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Invalid scrypt ${label}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid scrypt ${label}.`);
  }
  return parsed;
}

export function parsePasswordHash(encoded: string): ParsedPasswordHash {
  const parts = encoded.split("$");
  if (parts.length !== 7) {
    throw new Error("Malformed password hash.");
  }
  const [algorithm, version, rawN, rawR, rawP, rawSalt, rawDerivedKey] = parts;
  if (algorithm !== SCRYPT_POLICY.algorithm) {
    throw new Error("Unsupported password hash algorithm.");
  }
  if (version !== SCRYPT_POLICY.version) {
    throw new Error("Unsupported password hash version.");
  }
  if (
    rawN === undefined ||
    rawR === undefined ||
    rawP === undefined ||
    rawSalt === undefined ||
    rawDerivedKey === undefined
  ) {
    throw new Error("Malformed password hash.");
  }

  const N = parseInteger(rawN, "N");
  const r = parseInteger(rawR, "r");
  const p = parseInteger(rawP, "p");
  if (N !== SCRYPT_POLICY.N || r !== SCRYPT_POLICY.r || p !== SCRYPT_POLICY.p) {
    throw new Error("Password hash parameters do not match the approved policy.");
  }

  return {
    N,
    r,
    p,
    salt: decodeBase64Url(rawSalt, SCRYPT_POLICY.saltBytes, "salt"),
    derivedKey: decodeBase64Url(rawDerivedKey, SCRYPT_POLICY.derivedKeyBytes, "derived key"),
  };
}

function options(parsed: Pick<ParsedPasswordHash, "N" | "r" | "p">): ScryptOptions {
  return {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: SCRYPT_POLICY.maxmemBytes,
  };
}

export async function encodePasswordHash(
  password: string,
  salt: Buffer = randomBytes(SCRYPT_POLICY.saltBytes),
  primitives: Partial<ScryptPrimitives> = {},
): Promise<string> {
  if (password.length === 0) {
    throw new Error("Password must not be empty.");
  }
  if (salt.length !== SCRYPT_POLICY.saltBytes) {
    throw new Error("Salt must be exactly 16 bytes.");
  }
  const implementation = { ...DEFAULT_PRIMITIVES, ...primitives };
  const derivedKey = await implementation.derive(
    password,
    salt,
    SCRYPT_POLICY.derivedKeyBytes,
    options(SCRYPT_POLICY),
  );
  return [
    SCRYPT_POLICY.algorithm,
    SCRYPT_POLICY.version,
    String(SCRYPT_POLICY.N),
    String(SCRYPT_POLICY.r),
    String(SCRYPT_POLICY.p),
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  candidate: string,
  encoded: string,
  primitives: Partial<ScryptPrimitives> = {},
): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  const implementation = { ...DEFAULT_PRIMITIVES, ...primitives };
  const candidateKey = await implementation.derive(
    candidate,
    parsed.salt,
    SCRYPT_POLICY.derivedKeyBytes,
    options(parsed),
  );
  return implementation.timingSafeEqual(candidateKey, parsed.derivedKey);
}
