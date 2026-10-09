import type { ValidateFunction } from "ajv";
import type { FastifyInstance, FastifyReply } from "fastify";

import type { FrontendAssetBundle } from "../../infrastructure/static-frontend.js";
import type { PublicErrorResponse } from "../contracts.js";
import { sendPublicError } from "../errors.js";

export interface StaticFrontendRouteOptions {
  readonly bundle: FrontendAssetBundle;
  readonly validateError: ValidateFunction<PublicErrorResponse>;
}

async function methodNotAllowed(
  reply: FastifyReply,
  validateError: ValidateFunction<PublicErrorResponse>,
) {
  reply.header("Allow", "GET, HEAD");
  return sendPublicError(reply, validateError, 405);
}

export function registerStaticFrontendRoutes(
  application: FastifyInstance,
  options: StaticFrontendRouteOptions,
): void {
  application.get("/", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(options.bundle.indexHtml));

  application.get<{ Params: { filename: string } }>(
    "/assets/:filename",
    async (request, reply) => {
      const asset = options.bundle.assets.get(`/assets/${request.params.filename}`);
      if (asset === undefined) {
        return sendPublicError(reply, options.validateError, 404);
      }
      return reply.type(asset.contentType).send(asset.body);
    },
  );

  application.route({
    method: ["POST", "PUT", "PATCH", "DELETE"],
    url: "/",
    handler: async (_request, reply) => methodNotAllowed(reply, options.validateError),
  });
  application.route({
    method: ["POST", "PUT", "PATCH", "DELETE"],
    url: "/assets/:filename",
    handler: async (_request, reply) => methodNotAllowed(reply, options.validateError),
  });
}
