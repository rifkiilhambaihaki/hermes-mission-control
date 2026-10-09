import type { FastifyInstance } from "fastify";

import {
  createApplication,
  type CreateApplicationOptions,
} from "./application.js";

export async function createServer(options: CreateApplicationOptions): Promise<FastifyInstance> {
  return createApplication(options);
}
