import type { ValidateFunction } from "ajv";
import type { FastifyInstance } from "fastify";

import type { PublicErrorResponse } from "../contracts.js";
import { sendPublicError } from "../errors.js";
import { AuthFailureLimiter } from "../../security/auth-failure-limiter.js";
import { authenticateBasic } from "../../security/basic-authentication.js";

const AUTHENTICATE_HEADER = 'Basic realm="Hermes Mission Control", charset="UTF-8"';

export interface AuthenticationHookOptions {
  readonly username: string;
  readonly passwordHash: string;
  readonly limiter: AuthFailureLimiter;
  readonly validateError: ValidateFunction<PublicErrorResponse>;
}

export function registerAuthenticationHook(
  application: FastifyInstance,
  options: AuthenticationHookOptions,
): void {
  application.addHook("onRequest", async (request, reply) => {
    const authenticated = await authenticateBasic(
      request.headers.authorization,
      options.username,
      options.passwordHash,
    );
    if (authenticated) {
      options.limiter.recordSuccess();
      return;
    }

    const outcome = await options.limiter.recordFailure();
    if (outcome.blocked) {
      reply.header("Retry-After", String(outcome.retryAfterSeconds));
      return sendPublicError(reply, options.validateError, 429);
    }
    reply.header("WWW-Authenticate", AUTHENTICATE_HEADER);
    return sendPublicError(reply, options.validateError, 401);
  });
}
