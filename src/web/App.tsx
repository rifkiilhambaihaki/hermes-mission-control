import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchObservations,
  ObservationApiError,
  type ObservationAggregate,
  type ObservationSlot,
  type ObservationSource,
} from "./api";

type LoadState =
  | { readonly phase: "loading" }
  | { readonly phase: "success"; readonly data: ObservationAggregate }
  | { readonly phase: "failure"; readonly kind: ObservationApiError["kind"] };

interface AppProps {
  readonly loader?: () => Promise<ObservationAggregate>;
  readonly demoMode?: boolean;
}

const SOURCE_LABELS: Readonly<Record<ObservationSource, string>> = {
  HERMES_VERSION: "Hermes Version",
  HERMES_PROFILE: "Current Profile",
  HERMES_GATEWAY: "Gateway Process",
  HERMES_SCHEDULER: "Scheduler",
  ACCOUNTING_V2: "Accounting V2",
  BANK_JOURNAL: "Bank Journal",
  SUBMISSION_TRACKER: "Submission Tracker",
};

const STATUS_COPY = {
  AVAILABLE: "Available",
  EMPTY: "Empty",
  UNKNOWN: "Unknown",
  UNAVAILABLE: "Unavailable",
  STALE: "Stale",
} as const;

const FAILURE_COPY: Readonly<Record<ObservationApiError["kind"], { title: string; body: string }>> = {
  AUTH_REQUIRED: {
    title: "Authentication required",
    body: "Authenticate with the existing HTTP Basic Authentication boundary, then refresh this page.",
  },
  ACCESS_RESTRICTED: {
    title: "Access temporarily restricted",
    body: "The request was rejected or rate-limited. Wait briefly and try a manual refresh.",
  },
  API_UNAVAILABLE: {
    title: "Observation API unavailable",
    body: "Mission Control could not reach the local read-only observation endpoint.",
  },
  MALFORMED_RESPONSE: {
    title: "Observation response rejected",
    body: "The endpoint returned data that did not match the approved observation contract.",
  },
};

function defaultLoader(): Promise<ObservationAggregate> {
  return fetchObservations();
}

function Icon({ name }: { readonly name: "version" | "profile" | "gateway" | "scheduler" | "accounting" | "bank" | "submission" | "refresh" | "theme" }) {
  const paths: Readonly<Record<typeof name, React.ReactNode>> = {
    version: <><path d="M12 3 4.5 7v10L12 21l7.5-4V7L12 3Z" /><path d="m8 11 2.5 2.5L16 8" /></>,
    profile: <><circle cx="12" cy="8" r="3" /><path d="M5 20c.8-4 3.1-6 7-6s6.2 2 7 6" /></>,
    gateway: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 9h10M7 13h6M17 13h.01" /></>,
    scheduler: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    accounting: <><path d="M4 19V9m5 10V5m5 14v-7m5 7V3" /></>,
    bank: <><path d="m3 9 9-5 9 5M5 10v7m5-7v7m4-7v7m5-7v7M3 20h18" /></>,
    submission: <><path d="M6 3h9l3 3v15H6V3Z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
    refresh: <><path d="M20 6v5h-5" /><path d="M19 11a7 7 0 1 0 1 5" /></>,
    theme: <path d="M20 15.5A8 8 0 1 1 8.5 4 6.5 6.5 0 0 0 20 15.5Z" />,
  };
  return <svg aria-hidden="true" className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function StatusBadge({ value }: { readonly value: keyof typeof STATUS_COPY }) {
  return <span className={`status-badge status-${value.toLowerCase()}`}>{STATUS_COPY[value]}</span>;
}

function formatTimestamp(value: string | null): string {
  if (value === null) return "Not available";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

function formatIdr(value: unknown): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value));
}

function asCurrent(slot: ObservationSlot): Record<string, unknown> | null {
  return slot.current === null ? null : { ...slot.current };
}

function summaryOf(slot: ObservationSlot): Record<string, unknown> | null {
  const current = asCurrent(slot);
  const summary = current?.summary;
  return typeof summary === "object" && summary !== null && !Array.isArray(summary)
    ? { ...(summary as Record<string, unknown>) }
    : null;
}

function sourceIcon(source: ObservationSource): "version" | "profile" | "gateway" | "scheduler" | "accounting" | "bank" | "submission" {
  return ({
    HERMES_VERSION: "version",
    HERMES_PROFILE: "profile",
    HERMES_GATEWAY: "gateway",
    HERMES_SCHEDULER: "scheduler",
    ACCOUNTING_V2: "accounting",
    BANK_JOURNAL: "bank",
    SUBMISSION_TRACKER: "submission",
  } as const)[source];
}

function unavailableValue(slot: ObservationSlot): string {
  return slot.error_code === "INTEGRATION_PENDING" ? "Awaiting Integration" : "Data Belum Tersedia";
}

function OverviewCard({ slot }: { readonly slot: ObservationSlot }) {
  const current = asCurrent(slot);
  let value = unavailableValue(slot);
  let supporting = "Canonical observation is not available.";
  if (current !== null && slot.source === "HERMES_VERSION") {
    value = String(current.version);
    supporting = `${String(current.installation_kind)} · ${String(current.compatibility_status)}`;
  } else if (current !== null && slot.source === "HERMES_PROFILE") {
    value = `${String(current.current_profile_count)} current`;
    supporting = `${String(current.profile_count)} approved profile projection${Number(current.profile_count) === 1 ? "" : "s"}; names are not exposed.`;
  } else if (current !== null && slot.source === "HERMES_GATEWAY") {
    value = String(current.process_state);
    supporting = `Mode ${String(current.process_mode)} · service manager ${String(current.manager_category)}`;
  } else if (current !== null && slot.source === "HERMES_SCHEDULER") {
    value = `${String(current.enabled_job_count)} enabled / ${String(current.total_job_count)} total`;
    supporting = "Scheduling intent only; this does not prove execution or delivery health.";
  }
  return (
    <article className="metric-card" data-source={slot.source}>
      <div className="card-heading">
        <span className="icon-tile"><Icon name={sourceIcon(slot.source)} /></span>
        <StatusBadge value={slot.availability} />
      </div>
      <p className="card-label">{SOURCE_LABELS[slot.source]}</p>
      <strong className="metric-value">{value}</strong>
      <p className="supporting-copy">{supporting}</p>
    </article>
  );
}

function DomainCard({ slot }: { readonly slot: ObservationSlot }) {
  const summary = summaryOf(slot);
  const content: React.ReactNode[] = [];
  if (summary !== null && slot.source === "ACCOUNTING_V2") {
    content.push(
      <div className="domain-primary" key="cashflow"><span>Total cash outflow</span><strong>{formatIdr(summary.total_cash_outflow_idr)}</strong></div>,
      <div className="domain-grid" key="accounting-grid">
        <span>Income<strong>{formatIdr(summary.income_idr)}</strong></span>
        <span>Expenses<strong>{formatIdr(summary.expense_idr)}</strong></span>
        <span>Transactions<strong>{String(summary.transaction_count)}</strong></span>
      </div>,
    );
  } else if (summary !== null && slot.source === "BANK_JOURNAL") {
    content.push(
      <div className="domain-primary" key="issues"><span>Quality issues</span><strong>{String(summary.quality_issue_count)}</strong></div>,
      <div className="domain-grid" key="bank-grid">
        <span>Unresolved<strong>{String(summary.unresolved_mapping_count)}</strong></span>
        <span>Evidence gaps<strong>{String(summary.incomplete_evidence_count)}</strong></span>
        <span>Conflicts<strong>{String(summary.source_conflict_count)}</strong></span>
      </div>,
    );
  } else if (summary !== null && slot.source === "SUBMISSION_TRACKER") {
    content.push(
      <div className="domain-primary" key="active"><span>Active submissions</span><strong>{String(summary.active_count)}</strong></div>,
      <div className="domain-grid" key="submission-grid">
        <span>Total<strong>{String(summary.total_count)}</strong></span>
        <span>Revision<strong>{String(summary.revision_requested_count)}</strong></span>
        <span>Accepted<strong>{String(summary.accepted_count)}</strong></span>
      </div>,
    );
  } else {
    content.push(<div className="awaiting-panel" key="awaiting"><span className="awaiting-dot" />{unavailableValue(slot)}<small>No production sample data substituted.</small></div>);
  }
  return (
    <article className="domain-card" data-source={slot.source}>
      <div className="domain-header">
        <div><span className="icon-tile"><Icon name={sourceIcon(slot.source)} /></span><h3>{SOURCE_LABELS[slot.source]}</h3></div>
        <StatusBadge value={slot.availability} />
      </div>
      {content}
      {slot.review_status === "REVIEW_REQUIRED" && <p className="review-callout">Review required</p>}
    </article>
  );
}

function humanizeCode(value: string): string {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function ObservationDetail({ slot }: { readonly slot: ObservationSlot }) {
  return (
    <details className="observation-detail" data-source={slot.source}>
      <summary>
        <span className="detail-source"><span className="icon-tile small"><Icon name={sourceIcon(slot.source)} /></span><span><strong>{SOURCE_LABELS[slot.source]}</strong><small>{slot.source}</small></span></span>
        <span className="summary-status"><StatusBadge value={slot.availability} /><span className="chevron">⌄</span></span>
      </summary>
      <dl className="detail-grid">
        <div><dt>Availability</dt><dd>{slot.availability}</dd></div>
        <div><dt>Freshness</dt><dd>{slot.freshness}</dd></div>
        <div><dt>Completeness</dt><dd>{slot.completeness}</dd></div>
        <div><dt>Confidence</dt><dd>{slot.confidence_level}</dd></div>
        <div><dt>Review status</dt><dd>{slot.review_status}</dd></div>
        <div><dt>Observed</dt><dd>{formatTimestamp(slot.observation_timestamp)}</dd></div>
      </dl>
      {slot.error_code !== null && <p className="sanitized-error"><span>Sanitized status</span>{humanizeCode(slot.error_code)} <code>{slot.error_code}</code></p>}
    </details>
  );
}

function StateSummary({ observations }: { readonly observations: readonly ObservationSlot[] }) {
  const unknown = observations.filter((item) => item.availability === "UNKNOWN").length;
  const unavailable = observations.filter((item) => item.availability === "UNAVAILABLE").length;
  const uncertain = unknown + unavailable;
  const stale = observations.filter((item) => item.availability === "STALE" || item.freshness === "STALE" || item.freshness === "EXPIRED").length;
  const review = observations.filter((item) => item.review_status === "REVIEW_REQUIRED").length;
  const fresh = observations.filter((item) => item.freshness === "FRESH").length;
  return (
    <div className="state-summary" aria-label="Observation state summary">
      {unavailable === observations.length && <span className="state-chip state-critical">All sources unavailable</span>}
      {unknown === observations.length && <span className="state-chip state-neutral">All sources unknown</span>}
      {uncertain > 0 && unavailable < observations.length && unknown < observations.length && <span className="state-chip state-neutral">Partial data · {uncertain} uncertain</span>}
      {stale > 0 && <span className="state-chip state-stale">Stale observation · {stale}</span>}
      {review > 0 && <span className="state-chip state-review">Review required · {review}</span>}
      {fresh > 0 && stale === 0 && <span className="state-chip state-fresh">Fresh observation · {fresh}</span>}
    </div>
  );
}

export function App({ loader, demoMode = false }: AppProps) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [darkTheme, setDarkTheme] = useState(false);
  const requestInFlight = useRef(false);
  const activeLoader = useMemo(() => loader ?? defaultLoader, [loader]);

  const load = useCallback(async (manual = false) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    if (manual) setRefreshing(true);
    try {
      setState({ phase: "success", data: await activeLoader() });
    } catch (error) {
      setState({
        phase: "failure",
        kind: error instanceof ObservationApiError ? error.kind : "API_UNAVAILABLE",
      });
    } finally {
      requestInFlight.current = false;
      if (manual) setRefreshing(false);
    }
  }, [activeLoader]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleTheme(): void {
    const next = !darkTheme;
    setDarkTheme(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
  }

  const observations = state.phase === "success" ? state.data.observations : [];
  const bySource = new Map(observations.map((item) => [item.source, item]));

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true"><span>H</span></div>
        <div className="brand-copy"><h1>Hermes Mission Control</h1><p><span className="local-dot" />Local Monitoring</p></div>
        <div className="header-actions">
          {demoMode && <span className="demo-badge">DEMO DATA</span>}
          <div className="updated-block"><span>Last Updated</span><strong>{state.phase === "success" ? formatTimestamp(state.data.generated_at) : "—"}</strong></div>
          <button className="icon-button" type="button" onClick={toggleTheme} aria-label="Toggle color theme"><Icon name="theme" /></button>
          <button className="refresh-button" type="button" onClick={() => void load(true)} disabled={state.phase === "loading" || refreshing}>
            <Icon name="refresh" />{refreshing ? "Refreshing…" : "Manual Refresh"}
          </button>
        </div>
      </header>

      <main className="dashboard-main">
        {state.phase === "loading" && (
          <section className="loading-state" aria-live="polite">
            <span className="loading-orbit" aria-hidden="true" />
            <h2>Loading local observations</h2>
            <p>Requesting the authenticated, read-only observation endpoint.</p>
            <div className="skeleton-grid" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <span key={index} />)}</div>
          </section>
        )}

        {state.phase === "failure" && (
          <section className="failure-state" role="alert">
            <span className="failure-icon">!</span>
            <p className="section-kicker">Safe failure state</p>
            <h2>{FAILURE_COPY[state.kind].title}</h2>
            <p>{FAILURE_COPY[state.kind].body}</p>
            <button type="button" className="secondary-button" onClick={() => void load(true)}>Try manual refresh</button>
          </section>
        )}

        {state.phase === "success" && (
          <>
            <section className="welcome-row">
              <div><p className="section-kicker">Read-only operations surface</p><h2>System overview</h2><p>Independent canonical observations. Uncertainty remains visible and is never converted into health.</p></div>
              <StateSummary observations={observations} />
            </section>

            <section aria-labelledby="overview-heading">
              <div className="section-heading"><div><p className="section-kicker">Hermes Overview</p><h2 id="overview-heading">Core runtime signals</h2></div><span>{state.data.contract_version} contract</span></div>
              <div className="overview-grid">{(["HERMES_VERSION", "HERMES_PROFILE", "HERMES_GATEWAY", "HERMES_SCHEDULER"] as const).map((source) => <OverviewCard key={source} slot={bySource.get(source)!} />)}</div>
            </section>

            <section aria-labelledby="domain-heading">
              <div className="section-heading"><div><p className="section-kicker">Domain Monitoring</p><h2 id="domain-heading">Operational snapshots</h2></div><span>Aggregate projections only</span></div>
              <div className="domain-cards">{(["ACCOUNTING_V2", "BANK_JOURNAL", "SUBMISSION_TRACKER"] as const).map((source) => <DomainCard key={source} slot={bySource.get(source)!} />)}</div>
            </section>

            <section aria-labelledby="details-heading" className="details-section">
              <div className="section-heading"><div><p className="section-kicker">Observation Details</p><h2 id="details-heading">Source-by-source evidence</h2></div><span>Sanitized metadata</span></div>
              <div className="details-list">{observations.map((slot) => <ObservationDetail key={slot.source} slot={slot} />)}</div>
            </section>
          </>
        )}
      </main>
      <footer><span>Hermes Mission Control</span><span>Read-only · Local boundary · No automatic polling</span></footer>
    </div>
  );
}
