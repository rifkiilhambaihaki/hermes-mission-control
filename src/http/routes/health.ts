import type { ValidateFunction } from "ajv";
import type { FastifyInstance } from "fastify";

import type { ApplicationConfig } from "../../infrastructure/runtime-config.js";
import type { HealthResponse, HttpSchemas, PublicErrorResponse } from "../contracts.js";
import { EMPTY_QUERY_SCHEMA } from "../contracts.js";
import { sendPublicError } from "../errors.js";

export type HealthResponseFactory = (config: ApplicationConfig, now: Date) => unknown;

export interface HealthRouteOptions {
  readonly config: ApplicationConfig;
  readonly clock: () => Date;
  readonly schemas: HttpSchemas;
  readonly validateError: ValidateFunction<PublicErrorResponse>;
  readonly validateHealth: ValidateFunction<HealthResponse>;
  readonly responseFactory: HealthResponseFactory;
}

export function defaultHealthResponse(config: ApplicationConfig, now: Date): HealthResponse {
  return {
    application_name: config.applicationName,
    application_version: config.applicationVersion,
    build_id: config.buildId,
    api_version: config.apiVersion,
    application_time: now.toISOString(),
    status: "UP",
    read_only: true,
    authentication_enabled: true,
  };
}

export function registerHealthRoute(
  application: FastifyInstance,
  options: HealthRouteOptions,
): void {
  application.get(
    "/api/v1/health",
    {
      schema: {
        querystring: EMPTY_QUERY_SCHEMA,
        response: {
          200: options.schemas.health,
          400: options.schemas.error,
          401: options.schemas.error,
          429: options.schemas.error,
          500: options.schemas.error,
        },
      },
    },
    async () => {
      const response = options.responseFactory(options.config, options.clock());
      if (!options.validateHealth(response)) {
        throw new Error("Health response contract validation failed.");
      }
      return response;
    },
  );

  application.route({
    method: ["POST", "PUT", "PATCH", "DELETE"],
    url: "/api/v1/health",
    schema: {
      response: {
        401: options.schemas.error,
        405: options.schemas.error,
        429: options.schemas.error,
        500: options.schemas.error,
      },
    },
    handler: async (_request, reply) => {
      reply.header("Allow", "GET, HEAD");
      return sendPublicError(reply, options.validateError, 405);
    },
  });
}
