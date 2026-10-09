import type { FastifyInstance } from "fastify";

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function registerSecurityHeaders(application: FastifyInstance): void {
  application.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    reply.removeHeader("Server");
    reply.removeHeader("X-Powered-By");
  });
}
