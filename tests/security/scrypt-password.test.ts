import { describe, expect, it, vi } from "vitest";

import {
  SCRYPT_POLICY,
  encodePasswordHash,
  parsePasswordHash,
  verifyPassword,
  type ScryptPrimitives,
} from "../../src/security/scrypt-password.js";

const syntheticPassword = "Synthetic-Password-Only";
const syntheticSalt = Buffer.alloc(16, 0x5a);

function syntheticEncodedHash(
  algorithm = "scrypt",
  version = "v1",
  N = 32_768,
  r = 8,
  p = 1,
  salt = Buffer.alloc(16, 0x5a),
  derivedKey = Buffer.alloc(32),
): string {
  return [
    algorithm,
    version,
    String(N),
    String(r),
    String(p),
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

describe("scrypt password contract", () => {
  it("encodes and verifies the frozen parameters with explicit maxmem", async () => {
    const encoded = await encodePasswordHash(syntheticPassword, syntheticSalt);
    expect(encoded).toMatch(/^scrypt\$v1\$32768\$8\$1\$/);
    expect(parsePasswordHash(encoded)).toMatchObject({ N: 32_768, r: 8, p: 1 });
    expect(SCRYPT_POLICY).toEqual({
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
    await expect(verifyPassword(syntheticPassword, encoded)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", encoded)).resolves.toBe(false);
    await expect(verifyPassword("", encoded)).resolves.toBe(false);
    await expect(verifyPassword("unexpected-☃", encoded)).resolves.toBe(false);
  });

  it("uses the injected timing-safe equality path", async () => {
    const encoded = await encodePasswordHash(syntheticPassword, syntheticSalt);
    const timingSafeEqual = vi.fn((left: NodeJS.ArrayBufferView, right: NodeJS.ArrayBufferView) =>
      Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(
        Buffer.from(right.buffer, right.byteOffset, right.byteLength),
      ),
    );
    const primitives: Partial<ScryptPrimitives> = { timingSafeEqual };
    await expect(verifyPassword(syntheticPassword, encoded, primitives)).resolves.toBe(true);
    expect(timingSafeEqual).toHaveBeenCalledOnce();
  });

  it.each([
    ["malformed", "not-a-hash"],
    ["unsupported algorithm", syntheticEncodedHash("argon2")],
    ["unsupported version", syntheticEncodedHash("scrypt", "v2")],
    ["weak N", syntheticEncodedHash("scrypt", "v1", 16_384)],
    ["weak r", syntheticEncodedHash("scrypt", "v1", 32_768, 4)],
    ["oversized N", syntheticEncodedHash("scrypt", "v1", 65_536)],
    ["oversized p", syntheticEncodedHash("scrypt", "v1", 32_768, 8, 2)],
  ])("rejects %s before expensive derivation", async (_name, encoded) => {
    const derive = vi.fn(async () => Buffer.alloc(32));
    await expect(verifyPassword(syntheticPassword, encoded, { derive })).rejects.toThrow();
    expect(derive).not.toHaveBeenCalled();
  });

  it("rejects malformed salt and derived-key lengths", () => {
    expect(() =>
      parsePasswordHash(
        syntheticEncodedHash("scrypt", "v1", 32_768, 8, 1, Buffer.alloc(8)),
      ),
    ).toThrow();
    expect(() =>
      parsePasswordHash(
        syntheticEncodedHash(
          "scrypt",
          "v1",
          32_768,
          8,
          1,
          Buffer.alloc(16),
          Buffer.alloc(8),
        ),
      ),
    ).toThrow();
  });

  it("refuses to create a hash from an empty password or invalid salt", async () => {
    await expect(encodePasswordHash("", syntheticSalt)).rejects.toThrow();
    await expect(encodePasswordHash(syntheticPassword, Buffer.alloc(8))).rejects.toThrow();
  });
});
