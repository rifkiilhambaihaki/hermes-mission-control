import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApplication } from "../http/application.js";
import { loadRuntimeConfig, loadServerRuntimeConfig } from "../infrastructure/runtime-config.js";
import { createProductionLocalObservationService } from "../infrastructure/observations/index.js";
import { loadFrontendAssets } from "../infrastructure/static-frontend.js";

const APP_HOST = "127.0.0.1";
const serverConfig = loadServerRuntimeConfig();
const APP_PORT = serverConfig.port;
const PROJECT_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const FRONTEND_BUILD_DIRECTORY = resolve(PROJECT_ROOT, "dist", "web");

const config = loadRuntimeConfig({
  applicationName: "Hermes Mission Control",
  applicationVersion: "0.1.0",
  buildId: "open-source-edition",
  apiVersion: "v1",
});
const frontendAssets = await loadFrontendAssets(FRONTEND_BUILD_DIRECTORY);
const observationService = createProductionLocalObservationService(serverConfig.observations);
const application = await createApplication({
  config,
  dependencies: { frontendAssets, observationService },
});

let closing = false;
async function closeApplication(): Promise<void> {
  if (closing) return;
  closing = true;
  await application.close();
}

process.once("SIGINT", () => { void closeApplication(); });
process.once("SIGTERM", () => { void closeApplication(); });

await application.listen({ host: APP_HOST, port: APP_PORT });
