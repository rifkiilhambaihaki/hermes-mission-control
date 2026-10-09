import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import type { ObservationAggregate } from "./api";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Application root element is missing.");
}
const applicationRoot = rootElement;

function explicitLoopbackDemoRequest(): boolean {
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(window.location.hostname);
  return loopback && new URLSearchParams(window.location.search).get("demo") === "1";
}

async function explicitDemoLoader(): Promise<(() => Promise<ObservationAggregate>) | undefined> {
  const enabled = import.meta.env.DEV || import.meta.env.MODE === "demo";
  if (!enabled || !explicitLoopbackDemoRequest()) return undefined;
  const { DEMO_OBSERVATIONS } = await import("./demo-fixture");
  return async () => DEMO_OBSERVATIONS;
}

async function renderApplication(): Promise<void> {
  const loader = await explicitDemoLoader();
  createRoot(applicationRoot).render(
    <StrictMode>
      {loader === undefined ? <App /> : <App loader={loader} demoMode />}
    </StrictMode>,
  );
}

void renderApplication();
