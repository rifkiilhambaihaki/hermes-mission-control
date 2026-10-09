import type { FastifyReply } from "fastify";
import type { ValidateFunction } from "ajv";

import type { PublicErrorResponse } from "./contracts.js";

export type PublicStatusCode = 400 | 401 | 404 | 405 | 429 | 500;

const PUBLIC_ERRORS: Readonly<
  Record<PublicStatusCode, Readonly<Pick<PublicErrorResponse, "error" | "message">>>
> = {
  400: { error: "INVALID_REQUEST", message: "The request is invalid." },
  401: {
    error: "AUTHENTICATION_REQUIRED",
    message: "Authentication is required or failed.",
  },
  404: { error: "NOT_FOUND", message: "The requested resource was not found." },
  405: { error: "METHOD_NOT_ALLOWED", message: "The request method is not allowed." },
  429: {
    error: "TOO_MANY_AUTHENTICATION_ATTEMPTS",
    message: "Too many authentication attempts. Try again later.",
  },
  500: { error: "INTERNAL_ERROR", message: "An internal error occurred." },
};

export function publicErrorBody(statusCode: PublicStatusCode): PublicErrorResponse {
  return { ...PUBLIC_ERRORS[statusCode], status_code: statusCode };
}

export function sendPublicError(
  reply: FastifyReply,
  validate: ValidateFunction<PublicErrorResponse>,
  statusCode: PublicStatusCode,
): FastifyReply {
  const body = publicErrorBody(statusCode);
  if (!validate(body)) {
    throw new Error("Public error contract validation failed.");
  }
  return reply.code(statusCode).type("application/json; charset=utf-8").send(body);
}
