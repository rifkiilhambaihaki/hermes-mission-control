import type { ValidateFunction } from "ajv";
import type { FastifyInstance } from "fastify";

import type {
  ObservationAggregateDto,
  ObservationService,
} from "../../application/observations/observation-service.js";
import {
  EMPTY_QUERY_SCHEMA,
  type HttpSchemas,
  type ObservationsResponse,
  type PublicErrorResponse,
} from "../contracts.js";
import { sendPublicError } from "../errors.js";

export type ObservationResponseFactory = (result: ObservationAggregateDto) => unknown;

export interface ObservationRouteOptions {
  readonly service: ObservationService;
  readonly schemas: HttpSchemas;
  readonly validateError: ValidateFunction<PublicErrorResponse>;
  readonly validateObservations: ValidateFunction<ObservationsResponse>;
  readonly responseFactory: ObservationResponseFactory;
}

export function defaultObservationResponse(result: ObservationAggregateDto): ObservationAggregateDto {
  return result;
}

export function registerObservationRoute(
  application: FastifyInstance,
  options: ObservationRouteOptions,
): void {
  application.get(
    "/api/v1/observations",
    {
      schema: {
        querystring: EMPTY_QUERY_SCHEMA,
        response: {
          200: options.schemas.observations,
          400: options.schemas.error,
          401: options.schemas.error,
          429: options.schemas.error,
          500: options.schemas.error,
        },
      },
    },
    async () => {
      const response = options.responseFactory(await options.service.collect());
      if (!options.validateObservations(response)) {
        throw new Error("Observation response contract validation failed.");
      }
      return response;
    },
  );

  application.route({
    method: ["POST", "PUT", "PATCH", "DELETE"],
    url: "/api/v1/observations",
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
