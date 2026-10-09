import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import {
  DEFAULT_HTTP_SCHEMAS,
  FASTIFY_LOGGER_OPTIONS,
  createApplication,
  type ApplicationConfig,
  type AuditEntry,
} from "../../src/http/application.js";
import { encodePasswordHash } from "../../src/security/scrypt-password.js";

const username = "synthetic-user";
const password = "Synthetic-Password-Only";
let passwordHash = "";
const applications: FastifyInstance[] = [];

function authorization(user = username, candidate = password): string {
  return `Basic ${Buffer.from(`${user}:${candidate}`, "utf8").toString("base64")}`;
}

function syntheticEncodedHash(
  algorithm = "scrypt",
  version = "v1",
  N = 32_768,
  r = 8,
  p = 1,
): string {
  return [
    algorithm,
    version,
    String(N),
    String(r),
    String(p),
    Buffer.alloc(16, 0x33).toString("base64url"),
    Buffer.alloc(32).toString("base64url"),
  ].join("$");
}

function config(overrides: Partial<ApplicationConfig> = {}): ApplicationConfig {
  return {
    applicationName: "Hermes Mission Control",
    applicationVersion: "0.1.0-test",
    buildId: "synthetic-local",
    apiVersion: "v1",
    bindAddress: "127.0.0.1",
    basicUsername: username,
    basicPasswordHash: passwordHash,
    ...overrides,
  };
}

async function app(
  overrides: Partial<ApplicationConfig> = {},
  dependencies: Parameters<typeof createApplication>[0]["dependencies"] = {},
): Promise<FastifyInstance> {
  const instance = await createApplication({
    config: config(overrides),
    dependencies: {
      clock: () => new Date("2027-01-15T03:00:00.000Z"),
      sleep: async () => undefined,
      logStream: { write: () => undefined },
      ...dependencies,
    },
  });
  applications.push(instance);
  return instance;
}

beforeAll(async () => {
  passwordHash = await encodePasswordHash(password, Buffer.alloc(16, 0x33));
});

afterEach(async () => {
  await Promise.all(applications.splice(0).map(async (instance) => instance.close()));
});

describe("authenticated HTTP skeleton", () => {
  it("serves the schema-valid authenticated health response", async () => {
    const instance = await app();
    const response = await instance.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { authorization: authorization() },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      application_name: "Hermes Mission Control",
      application_version: "0.1.0-test",
      build_id: "synthetic-local",
      api_version: "v1",
      application_time: "2027-01-15T03:00:00.000Z",
      status: "UP",
      read_only: true,
      authentication_enabled: true,
    });
  });

  it.each([
    ["missing", undefined],
    ["malformed scheme", "Bearer fake"],
    ["invalid base64", "Basic !!!!"],
    ["missing colon", `Basic ${Buffer.from("synthetic-user", "utf8").toString("base64")}`],
    ["wrong username", authorization("other-user", password)],
    ["wrong password", authorization(username, "wrong-password")],
    ["empty password", authorization(username, "")],
    ["unicode input", authorization("pengguna-☃", "kata-sandi-☃")],
  ])("returns the same 401 contract for %s credentials", async (_name, header) => {
    const instance = await app();
    const headers = header === undefined ? {} : { authorization: header };
    const response = await instance.inject({ method: "GET", url: "/api/v1/health", headers });
    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toBe(
      'Basic realm="Hermes Mission Control", charset="UTF-8"',
    );
    expect(response.json()).toEqual({
      error: "AUTHENTICATION_REQUIRED",
      message: "Authentication is required or failed.",
      status_code: 401,
    });
  });

  it("rate-limits the fifth failed attempt with sanitized Retry-After", async () => {
    let now = Date.parse("2027-01-15T03:00:00.000Z");
    const delays: number[] = [];
    const instance = await app({}, {
      clock: () => new Date(now),
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await instance.inject({
        method: "GET",
        url: "/api/v1/health",
        headers: { authorization: authorization(username, "wrong") },
      });
      expect(response.statusCode).toBe(401);
    }
    const blocked = await instance.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { authorization: authorization(username, "wrong") },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toMatch(/^\d+$/);
    expect(blocked.json()).toEqual({
      error: "TOO_MANY_AUTHENTICATION_ATTEMPTS",
      message: "Too many authentication attempts. Try again later.",
      status_code: 429,
    });
    expect(delays).toEqual([1_000, 2_000]);

    now += 5 * 60 * 1_000 + 1;
    const recovered = await instance.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { authorization: authorization() },
    });
    expect(recovered.statusCode).toBe(200);
  });

  it("protects mutation routes before applying method policy", async () => {
    const instance = await app();
    const response = await instance.inject({ method: "POST", url: "/api/v1/health" });
    expect(response.statusCode).toBe(401);
  });

  it("supports authenticated HEAD and denies mutation methods on the known route", async () => {
    const instance = await app();
    const head = await instance.inject({
      method: "HEAD",
      url: "/api/v1/health",
      headers: { authorization: authorization() },
    });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");

    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const response = await instance.inject({
        method,
        url: "/api/v1/health",
        headers: { authorization: authorization() },
      });
      expect(response.statusCode).toBe(405);
      expect(response.headers.allow).toBe("GET, HEAD");
      expect(response.json()).toEqual({
        error: "METHOD_NOT_ALLOWED",
        message: "The request method is not allowed.",
        status_code: 405,
      });
    }
  });

  it("returns sanitized JSON 400 and 404 responses", async () => {
    const instance = await app();
    const invalid = await instance.inject({
      method: "GET",
      url: "/api/v1/health?unexpected=true",
      headers: { authorization: authorization() },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The request is invalid.",
      status_code: 400,
    });
    expect(invalid.body).not.toContain("stack");

    const missing = await instance.inject({
      method: "GET",
      url: "/api/v1/unknown",
      headers: { authorization: authorization() },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      error: "NOT_FOUND",
      message: "The requested resource was not found.",
      status_code: 404,
    });
  });

  it.each(["/command", "/run", "/query", "/config", "/refresh"])(
    "does not expose generic endpoint %s",
    async (url) => {
      const instance = await app();
      const response = await instance.inject({
        method: "GET",
        url,
        headers: { authorization: authorization() },
      });
      expect(response.statusCode).toBe(404);
    },
  );

  it("sets restrictive security headers without CORS or server fingerprinting", async () => {
    const instance = await app();
    const response = await instance.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { authorization: authorization() },
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers.server).toBeUndefined();
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("never places credentials, Authorization, hashes, or stack traces in captured logs", async () => {
    const entries: AuditEntry[] = [];
    const pinoLines: string[] = [];
    const instance = await app({}, {
      auditSink: (entry) => entries.push(entry),
      logStream: { write: (line) => pinoLines.push(line) },
    });
    const secretHeader = authorization(username, "wrong-password-canary");
    const response = await instance.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { authorization: secretHeader, cookie: "synthetic-cookie-canary" },
    });
    expect(response.statusCode).toBe(401);
    expect(entries).toHaveLength(1);
    expect(pinoLines.length).toBeGreaterThan(0);
    const serialized = JSON.stringify({ entries, pinoLines });
    for (const prohibited of [
      secretHeader,
      "wrong-password-canary",
      passwordHash,
      "synthetic-cookie-canary",
      "authorization",
      "stack",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(prohibited.toLowerCase());
      expect(response.body.toLowerCase()).not.toContain(prohibited.toLowerCase());
    }
  });

  it("configures Fastify redaction for sensitive request fields", () => {
    const redactions = FASTIFY_LOGGER_OPTIONS.redact.paths;
    expect(redactions).toContain("req.headers.authorization");
    expect(redactions).toContain("req.headers.cookie");
    expect(redactions).toContain("password");
    expect(redactions).toContain("passwordHash");
  });

  it("fails closed if a health response includes an unexpected field", async () => {
    const instance = await app({}, {
      healthResponseFactory: (runtime) => ({
        application_name: runtime.applicationName,
        application_version: runtime.applicationVersion,
        build_id: runtime.buildId,
        api_version: runtime.apiVersion,
        application_time: "2027-01-15T03:00:00.000Z",
        status: "UP",
        read_only: true,
        authentication_enabled: true,
        prohibited_path: "/synthetic/not-real",
      }),
    });
    const response = await instance.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { authorization: authorization() },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "An internal error occurred.",
      status_code: 500,
    });
    expect(response.body).not.toContain("prohibited_path");
    expect(response.body).not.toContain("synthetic/not-real");
  });
});

describe("startup fail-closed validation", () => {
  it.each([
    ["missing username", { basicUsername: "" }],
    ["invalid username", { basicUsername: "invalid user" }],
    ["missing hash", { basicPasswordHash: "" }],
    ["malformed hash", { basicPasswordHash: "not-a-hash" }],
    ["unsupported algorithm", { basicPasswordHash: syntheticEncodedHash("argon2") }],
    ["unsupported version", { basicPasswordHash: syntheticEncodedHash("scrypt", "v2") }],
    ["weak hash", { basicPasswordHash: syntheticEncodedHash("scrypt", "v1", 16_384) }],
    ["invalid application invariant", { applicationName: "" }],
    ["invalid bind", { bindAddress: "0.0.0.0" as const }],
  ])("rejects %s", async (_name, override) => {
    await expect(createApplication({ config: config(override as Partial<ApplicationConfig>) })).rejects.toThrow();
  });

  it("fails startup when a required response schema cannot compile", async () => {
    await expect(
      createApplication({
        config: config(),
        dependencies: {
          schemas: {
            ...DEFAULT_HTTP_SCHEMAS,
            health: { type: "not-a-json-schema-type" },
          },
        },
      }),
    ).rejects.toThrow();
  });
});
