// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import {
  fetchObservations,
  ObservationApiError,
  parseObservationAggregate,
  type ObservationAggregate,
} from "./api";
import { DEMO_OBSERVATIONS } from "./demo-fixture";

function fixture(): ObservationAggregate {
  return structuredClone(DEMO_OBSERVATIONS);
}

function withSlots(
  transform: (data: ObservationAggregate) => void,
): ObservationAggregate {
  const data = fixture();
  transform(data);
  return data;
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value) => resolvePromise?.(value) };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
  delete document.documentElement.dataset.theme;
});

describe("Mission Control dashboard", () => {
  it("renders the exact seven canonical sources", async () => {
    render(<App loader={async () => fixture()} />);

    await screen.findByRole("heading", { name: "System overview" });
    const details = document.querySelectorAll("details[data-source]");
    expect(details).toHaveLength(7);
    expect([...details].map((element) => element.getAttribute("data-source"))).toEqual([
      "HERMES_VERSION",
      "HERMES_PROFILE",
      "HERMES_GATEWAY",
      "HERMES_SCHEDULER",
      "ACCOUNTING_V2",
      "BANK_JOURNAL",
      "SUBMISSION_TRACKER",
    ]);
  });

  it("keeps mixed availability visible as partial data", async () => {
    render(<App loader={async () => fixture()} />);

    expect(await screen.findByText(/Partial data · 1 uncertain/)).toBeTruthy();
    expect(screen.getByText(/Stale observation · 1/)).toBeTruthy();
    expect(screen.getByText(/Review required · 3/)).toBeTruthy();
    expect(document.querySelector('[data-source="ACCOUNTING_V2"]')).toBeTruthy();
    expect(document.querySelector('[data-source="SUBMISSION_TRACKER"]')).toBeTruthy();
  });

  it("shows a dedicated initial loading state", () => {
    const pending = deferred<ObservationAggregate>();
    render(<App loader={() => pending.promise} />);

    expect(screen.getByRole("heading", { name: "Loading local observations" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "System overview" })).toBeNull();
  });

  it("presents stale and unknown as distinct non-healthy states", async () => {
    render(<App loader={async () => fixture()} />);

    await screen.findByRole("heading", { name: "System overview" });
    const staleCard = document.querySelector('.domain-card[data-source="BANK_JOURNAL"] .status-stale');
    const unknownCard = document.querySelector('.metric-card[data-source="HERMES_PROFILE"] .status-unknown');
    expect(staleCard?.textContent).toBe("Stale");
    expect(unknownCard?.textContent).toBe("Unknown");
    expect(unknownCard?.classList.contains("status-available")).toBe(false);
    expect(screen.getByText("Awaiting Integration")).toBeTruthy();
    const submissionCard = document.querySelector('.domain-card[data-source="SUBMISSION_TRACKER"]');
    expect(submissionCard?.textContent).toContain("Active submissions4");
    expect(submissionCard?.textContent).toContain("Total12");
  });

  it("shows Gateway process proof while preserving service-manager uncertainty", async () => {
    render(<App loader={async () => fixture()} />);

    const gateway = await waitFor(() => {
      const element = document.querySelector('.metric-card[data-source="HERMES_GATEWAY"]');
      expect(element).not.toBeNull();
      return element;
    });
    expect(gateway?.textContent).toContain("RUNNING");
    expect(gateway?.textContent).toContain("service manager UNKNOWN");
    expect(document.body.textContent).not.toMatch(/gatewayHealthy|Gateway healthy/i);
  });

  it("describes Scheduler counts as intent rather than runtime health", async () => {
    render(<App loader={async () => fixture()} />);

    expect(await screen.findByText("4 enabled / 6 total")).toBeTruthy();
    expect(screen.getByText(/Scheduling intent only; this does not prove execution or delivery health/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/scheduler (?:is )?running|scheduler healthy/i);
  });

  it("uses integration-pending states for missing domain snapshots without fake values", async () => {
    const data = withSlots((draft) => {
      for (const slot of draft.observations.slice(4)) {
        Object.assign(slot, {
          availability: "UNKNOWN",
          completeness: "UNKNOWN",
          freshness: "UNKNOWN",
          review_status: "REVIEW_REQUIRED",
          confidence_level: "NONE",
          observation_timestamp: null,
          current: null,
          error_code: "INTEGRATION_PENDING",
        });
      }
    });
    render(<App loader={async () => data} />);

    await screen.findByRole("heading", { name: "Operational snapshots" });
    const domainCards = [...document.querySelectorAll(".domain-card")];
    expect(domainCards.filter((card) => card.textContent?.includes("Awaiting Integration"))).toHaveLength(3);
    expect(domainCards.filter((card) => card.textContent?.includes("No production sample data substituted."))).toHaveLength(3);
  });

  it("shows an all-sources-unavailable state without collapsing cards", async () => {
    const data = withSlots((draft) => {
      for (const slot of draft.observations) {
        Object.assign(slot, {
          availability: "UNAVAILABLE",
          completeness: "UNKNOWN",
          freshness: "UNKNOWN",
          review_status: "REVIEW_REQUIRED",
          confidence_level: "NONE",
          observation_timestamp: null,
          current: null,
          error_code: "SOURCE_OBSERVATION_FAILED",
        });
      }
    });
    render(<App loader={async () => data} />);

    expect(await screen.findByText("All sources unavailable")).toBeTruthy();
    expect(document.querySelectorAll("details[data-source]")).toHaveLength(7);
  });

  it("does not relabel all-UNKNOWN observations as unavailable", async () => {
    const data = withSlots((draft) => {
      for (const slot of draft.observations) {
        Object.assign(slot, {
          availability: "UNKNOWN",
          completeness: "UNKNOWN",
          freshness: "UNKNOWN",
          review_status: "REVIEW_REQUIRED",
          confidence_level: "NONE",
          observation_timestamp: null,
          current: null,
          error_code: "INTEGRATION_PENDING",
        });
      }
    });
    render(<App loader={async () => data} />);

    expect(await screen.findByText("All sources unknown")).toBeTruthy();
    expect(screen.queryByText("All sources unavailable")).toBeNull();
  });

  it("handles authentication, restriction, API, and malformed failures with safe copy", async () => {
    const cases = [
      ["AUTH_REQUIRED", "Authentication required"],
      ["ACCESS_RESTRICTED", "Access temporarily restricted"],
      ["API_UNAVAILABLE", "Observation API unavailable"],
      ["MALFORMED_RESPONSE", "Observation response rejected"],
    ] as const;
    for (const [kind, heading] of cases) {
      const view = render(<App loader={async () => { throw new ObservationApiError(kind); }} />);
      expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
      expect(document.body.textContent).not.toMatch(/stack|password|token|raw response/i);
      view.unmount();
    }
  });

  it("labels synthetic data only when the development bootstrap explicitly enables preview", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    render(<App loader={async () => fixture()} demoMode />);

    expect(await screen.findByText("DEMO DATA")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("0.9.0-demo")).toBeTruthy();
  });

  it("does not let a production-style demo query bypass the canonical API loader", async () => {
    window.history.replaceState({}, "", "/?demo=1");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(fixture()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await screen.findByRole("heading", { name: "System overview" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("DEMO DATA")).toBeNull();
  });

  it("performs only same-origin no-store GET requests and manual refresh repeats the GET", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(fixture()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await screen.findByRole("heading", { name: "System overview" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/observations", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Manual Refresh" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "GET")).toBe(true);
    expect(fetchMock.mock.calls.some((call) => "body" in (call[1] ?? {}))).toBe(false);
  });

  it("prevents manual refresh from overlapping the initial request", async () => {
    const pending = deferred<ObservationAggregate>();
    const loader = vi.fn(() => pending.promise);
    render(<App loader={loader} />);

    const refresh = screen.getByRole("button", { name: "Manual Refresh" });
    expect((refresh as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(refresh);
    expect(loader).toHaveBeenCalledTimes(1);

    pending.resolve(fixture());
    await screen.findByRole("heading", { name: "System overview" });
    expect((refresh as HTMLButtonElement).disabled).toBe(false);
  });

  it("maps HTTP authentication and service errors without reading raw error bodies", async () => {
    const json = vi.fn(async () => ({ secret: "must-not-be-read" }));
    await expect(fetchObservations(async () => ({ status: 401, ok: false, json }) as unknown as Response))
      .rejects.toMatchObject({ kind: "AUTH_REQUIRED" });
    expect(json).not.toHaveBeenCalled();

    await expect(fetchObservations(async () => ({ status: 429, ok: false, json }) as unknown as Response))
      .rejects.toMatchObject({ kind: "ACCESS_RESTRICTED" });
    await expect(fetchObservations(async () => ({ status: 500, ok: false, json }) as unknown as Response))
      .rejects.toMatchObject({ kind: "API_UNAVAILABLE" });
    expect(json).not.toHaveBeenCalled();
  });

  it("rejects malformed or secret-bearing parallel response contracts", () => {
    expect(() => parseObservationAggregate({ contract_version: "parallel", observations: [] }))
      .toThrowError(ObservationApiError);

    const secretBearing = fixture() as ObservationAggregate & { token?: string };
    secretBearing.token = "synthetic-secret-canary";
    expect(() => parseObservationAggregate(secretBearing)).toThrowError(ObservationApiError);

    const extraPrivateField = fixture();
    Object.assign(extraPrivateField.observations[0]?.current ?? {}, { profile_name: "synthetic-private-profile" });
    expect(() => parseObservationAggregate(extraPrivateField)).toThrowError(ObservationApiError);
  });

  it("rejects observation metadata/current combinations that violate canonical invariants", () => {
    const unavailableWithCurrent = fixture();
    Object.assign(unavailableWithCurrent.observations[2]!, {
      availability: "UNAVAILABLE",
      completeness: "UNKNOWN",
      freshness: "UNKNOWN",
      confidence_level: "NONE",
      error_code: "SOURCE_OBSERVATION_FAILED",
    });
    expect(() => parseObservationAggregate(unavailableWithCurrent)).toThrowError(ObservationApiError);

    const unknownWithConfidence = fixture();
    Object.assign(unknownWithConfidence.observations[1]!, {
      availability: "UNKNOWN",
      completeness: "UNKNOWN",
      freshness: "UNKNOWN",
      confidence_level: "HIGH",
      current: null,
      error_code: "INTEGRATION_PENDING",
    });
    expect(() => parseObservationAggregate(unknownWithConfidence)).toThrowError(ObservationApiError);

    const availableWithoutCurrent = fixture();
    Object.assign(availableWithoutCurrent.observations[0]!, { current: null });
    expect(() => parseObservationAggregate(availableWithoutCurrent)).toThrowError(ObservationApiError);
  });
});
