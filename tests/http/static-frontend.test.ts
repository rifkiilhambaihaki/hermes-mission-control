import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { ObservationService } from "../../src/application/observations/observation-service.js";
import {
  createApplication,
  type ApplicationConfig,
} from "../../src/http/application.js";
import type { FrontendAssetBundle } from "../../src/infrastructure/static-frontend.js";
import { encodePasswordHash } from "../../src/security/scrypt-password.js";

const username = "synthetic-user";
const password = "Synthetic-Password-Only";
let passwordHash = "";
const applications: FastifyInstance[] = [];

function authorization(): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function config(): ApplicationConfig {
  return {
    applicationName: "Hermes Mission Control",
    applicationVersion: "0.1.0-test",
    buildId: "synthetic-static-test",
    apiVersion: "v1",
    bindAddress: "127.0.0.1",
    basicUsername: username,
    basicPasswordHash: passwordHash,
  };
}

function frontendAssets(): FrontendAssetBundle {
  return {
    indexHtml: Buffer.from(
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>',
      "utf8",
    ),
    assets: new Map([
      ["/assets/app.js", {
        body: Buffer.from('fetch("/api/v1/observations", { method: "GET" });', "utf8"),
        contentType: "text/javascript; charset=utf-8",
      }],
      ["/assets/app.css", {
        body: Buffer.from("body { color: #123c36; }", "utf8"),
        contentType: "text/css; charset=utf-8",
      }],
    ]),
  };
}

async function app(options: {
  readonly providerCalls?: { value: number };
  readonly logLines?: string[];
} = {}): Promise<FastifyInstance> {
  const observationService = new ObservationService({
    clock: () => new Date("2027-01-15T03:00:00.000Z"),
    providers: options.providerCalls === undefined
      ? {}
      : {
          HERMES_VERSION: async () => {
            options.providerCalls!.value += 1;
            throw new Error("synthetic provider should not run for static requests");
          },
        },
  });
  const instance = await createApplication({
    config: config(),
    dependencies: {
      clock: () => new Date("2027-01-15T03:00:00.000Z"),
      sleep: async () => undefined,
      logStream: { write: (line) => { options.logLines?.push(line); } },
      frontendAssets: frontendAssets(),
      observationService,
    },
  });
  applications.push(instance);
  return instance;
}

beforeAll(async () => {
  passwordHash = await encodePasswordHash(password, Buffer.alloc(16, 0x66));
});

afterEach(async () => {
  await Promise.all(applications.splice(0).map(async (instance) => instance.close()));
});

describe("authenticated static Mission Control frontend", () => {
  it.each(["/", "/?demo=1", "/assets/app.js", "/assets/app.css"])(
    "rejects unauthenticated browser request %s before serving content",
    async (url) => {
      const response = await (await app()).inject({ method: "GET", url });
      expect(response.statusCode).toBe(401);
      expect(response.headers["www-authenticate"]).toBe(
        'Basic realm="Hermes Mission Control", charset="UTF-8"',
      );
      expect(response.body).not.toContain("root");
      expect(response.body).not.toContain("fetch(");
    },
  );

  it("serves the homepage and fixed JS/CSS assets after authentication", async () => {
    const instance = await app();
    const home = await instance.inject({
      method: "GET",
      url: "/",
      headers: { authorization: authorization() },
    });
    expect(home.statusCode).toBe(200);
    expect(home.headers["content-type"]).toContain("text/html");
    expect(home.body).toContain('<div id="root"></div>');

    const javascript = await instance.inject({
      method: "GET",
      url: "/assets/app.js",
      headers: { authorization: authorization() },
    });
    expect(javascript.statusCode).toBe(200);
    expect(javascript.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(javascript.body).toContain("/api/v1/observations");

    const css = await instance.inject({
      method: "GET",
      url: "/assets/app.css",
      headers: { authorization: authorization() },
    });
    expect(css.statusCode).toBe(200);
    expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
  });

  it("does not serve source maps, directory listings, private files, or path traversal", async () => {
    const instance = await app();
    for (const url of [
      "/assets/app.js.map",
      "/assets/",
      "/package.json",
      "/src/web/App.tsx",
      "/assets/%2e%2e%2fpackage.json",
    ]) {
      const response = await instance.inject({
        method: "GET",
        url,
        headers: { authorization: authorization() },
      });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain("hermes-mission-control");
    }
  });

  it("applies read-only method policy to homepage and assets", async () => {
    const instance = await app();
    for (const url of ["/", "/assets/app.js"]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
        const response = await instance.inject({
          method,
          url,
          headers: { authorization: authorization() },
        });
        expect(response.statusCode).toBe(405);
        expect(response.headers.allow).toBe("GET, HEAD");
      }
    }
  });

  it("keeps frontend and seven-slot API on the same authenticated origin", async () => {
    const instance = await app();
    const response = await instance.inject({
      method: "GET",
      url: "/api/v1/observations",
      headers: { authorization: authorization() },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().observations).toHaveLength(7);
    expect(response.json().observations.every(
      (slot: { availability: string; error_code: string | null }) =>
        slot.availability === "UNKNOWN" && slot.error_code === "INTEGRATION_PENDING",
    )).toBe(true);
  });

  it("allows only same-origin scripts, styles, and API connections in CSP", async () => {
    const response = await (await app()).inject({
      method: "GET",
      url: "/",
      headers: { authorization: authorization() },
    });
    const policy = response.headers["content-security-policy"];
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("style-src 'self'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("does not trigger observation providers for browser document or asset requests", async () => {
    const providerCalls = { value: 0 };
    const instance = await app({ providerCalls });
    for (const url of ["/", "/assets/app.js", "/assets/app.css"]) {
      const response = await instance.inject({
        method: "GET",
        url,
        headers: { authorization: authorization() },
      });
      expect(response.statusCode).toBe(200);
    }
    expect(providerCalls.value).toBe(0);
  });

  it("does not place credentials or query strings in audit logs", async () => {
    const logLines: string[] = [];
    const instance = await app({ logLines });
    const secretHeader = authorization();
    const response = await instance.inject({
      method: "GET",
      url: "/?demo=1&credential=synthetic-query-canary",
      headers: { authorization: secretHeader },
    });
    expect(response.statusCode).toBe(200);
    const logs = logLines.join("\n");
    expect(logs).not.toContain(secretHeader);
    expect(logs).not.toContain(password);
    expect(logs).not.toContain(passwordHash);
    expect(logs).not.toContain("synthetic-query-canary");
  });
});
