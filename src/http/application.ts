import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import Fastify, { LogController, type FastifyInstance } from "fastify";

import { ObservationService } from "../application/observations/observation-service.js";

import {
  validateApplicationConfig,
  type ApplicationConfig,
} from "../infrastructure/runtime-config.js";
import type { FrontendAssetBundle } from "../infrastructure/static-frontend.js";
import { AuthFailureLimiter } from "../security/auth-failure-limiter.js";
import {
  HEALTH_RESPONSE_SCHEMA,
  OBSERVATIONS_RESPONSE_SCHEMA,
  PUBLIC_ERROR_SCHEMA,
  type HealthResponse,
  type HttpSchemas,
  type ObservationsResponse,
  type PublicErrorResponse,
} from "./contracts.js";
import { sendPublicError } from "./errors.js";
import { registerAuthenticationHook } from "./hooks/authentication.js";
import {
  defaultHealthResponse,
  registerHealthRoute,
  type HealthResponseFactory,
} from "./routes/health.js";
import {
  defaultObservationResponse,
  registerObservationRoute,
  type ObservationResponseFactory,
} from "./routes/observations.js";
import { registerStaticFrontendRoutes } from "./routes/static-frontend.js";
import { registerSecurityHeaders } from "./security-headers.js";

export type { ApplicationConfig } from "../infrastructure/runtime-config.js";

export interface AuditEntry {
  readonly event: "http_response";
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
}

export interface ApplicationDependencies {
  readonly clock?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly auditSink?: (entry: AuditEntry) => void;
  readonly logStream?: { write(message: string): void };
  readonly schemas?: HttpSchemas;
  readonly healthResponseFactory?: HealthResponseFactory;
  readonly observationService?: ObservationService;
  readonly observationResponseFactory?: ObservationResponseFactory;
  readonly frontendAssets?: FrontendAssetBundle;
}

export interface CreateApplicationOptions {
  readonly config: ApplicationConfig;
  readonly dependencies?: ApplicationDependencies;
}

export const DEFAULT_HTTP_SCHEMAS: HttpSchemas = Object.freeze({
  health: HEALTH_RESPONSE_SCHEMA,
  observations: OBSERVATIONS_RESPONSE_SCHEMA,
  error: PUBLIC_ERROR_SCHEMA,
});

export const FASTIFY_LOGGER_OPTIONS = {
  level: "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "request.headers.authorization",
      "request.headers.cookie",
      "password",
      "passwordHash",
      "*.password",
      "*.passwordHash",
      "body.password",
      "body.passwordHash",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    req(request: { method: string; url: string }) {
      return { method: request.method, url: request.url.split("?", 1)[0] ?? "/" };
    },
  },
};

interface CompiledSchemas {
  readonly validateHealth: ValidateFunction<HealthResponse>;
  readonly validateObservations: ValidateFunction<ObservationsResponse>;
  readonly validateError: ValidateFunction<PublicErrorResponse>;
}

function compileRequiredSchemas(schemas: HttpSchemas): CompiledSchemas {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const addFormats = addFormatsModule as unknown as (instance: Ajv2020) => void;
  addFormats(ajv);
  return {
    validateHealth: ajv.compile<HealthResponse>(schemas.health),
    validateObservations: ajv.compile<ObservationsResponse>(schemas.observations),
    validateError: ajv.compile<PublicErrorResponse>(schemas.error),
  };
}

function defaultClock(): Date {
  return new Date();
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safePath(url: string): string {
  return url.split("?", 1)[0] ?? "/";
}

export function createHttpApp(options: CreateApplicationOptions): FastifyInstance {
  const config = validateApplicationConfig(options.config);
  const dependencies = options.dependencies ?? {};
  const schemas = dependencies.schemas ?? DEFAULT_HTTP_SCHEMAS;
  const compiled = compileRequiredSchemas(schemas);
  const clock = dependencies.clock ?? defaultClock;
  const sleep = dependencies.sleep ?? defaultSleep;
  const limiter = new AuthFailureLimiter({ clock: () => clock().getTime(), sleep });

  const application = Fastify({
    logger:
      dependencies.logStream === undefined
        ? FASTIFY_LOGGER_OPTIONS
        : { ...FASTIFY_LOGGER_OPTIONS, stream: dependencies.logStream },
    logController: new LogController({ disableRequestLogging: true }),
    exposeHeadRoutes: true,
  });

  registerSecurityHeaders(application);
  registerAuthenticationHook(application, {
    username: config.basicUsername,
    passwordHash: config.basicPasswordHash,
    limiter,
    validateError: compiled.validateError,
  });
  registerHealthRoute(application, {
    config,
    clock,
    schemas,
    validateError: compiled.validateError,
    validateHealth: compiled.validateHealth,
    responseFactory: dependencies.healthResponseFactory ?? defaultHealthResponse,
  });
  registerObservationRoute(application, {
    service: dependencies.observationService ?? new ObservationService({ clock }),
    schemas,
    validateError: compiled.validateError,
    validateObservations: compiled.validateObservations,
    responseFactory: dependencies.observationResponseFactory ?? defaultObservationResponse,
  });
  if (dependencies.frontendAssets !== undefined) {
    registerStaticFrontendRoutes(application, {
      bundle: dependencies.frontendAssets,
      validateError: compiled.validateError,
    });
  }

  application.setNotFoundHandler(async (_request, reply) =>
    sendPublicError(reply, compiled.validateError, 404),
  );

  application.setErrorHandler(async (error, _request, reply) => {
    const validationFailure =
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      (error as { validation?: unknown }).validation !== undefined;
    return sendPublicError(reply, compiled.validateError, validationFailure ? 400 : 500);
  });

  application.addHook("onResponse", async (request, reply) => {
    const entry: AuditEntry = {
      event: "http_response",
      method: request.method,
      path: safePath(request.url),
      statusCode: reply.statusCode,
    };
    request.log.info(entry, "HTTP response completed");
    dependencies.auditSink?.(entry);
  });

  return application;
}

export async function createApplication(
  options: CreateApplicationOptions,
): Promise<FastifyInstance> {
  const application = createHttpApp(options);
  try {
    await application.ready();
    return application;
  } catch (error) {
    await application.close();
    throw error;
  }
}
