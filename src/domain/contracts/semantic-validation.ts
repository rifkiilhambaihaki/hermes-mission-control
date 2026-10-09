import { evaluateAssetCadence, isCapturedLate } from "../accounting/asset-cadence.js";
import type {
  AccountingSnapshot,
  BankJournalIssueCode,
  BankJournalSnapshot,
  DetailWindow,
  SnapshotHeader,
  SubmissionRecordedStatus,
  SubmissionSnapshot,
} from "./snapshot-types.js";

export interface SemanticValidationOptions {
  readonly asOf: string;
  readonly futureToleranceMs: number;
}

export interface SemanticIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface SemanticValidationResult {
  readonly valid: boolean;
  readonly issues: readonly SemanticIssue[];
}

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const EXTERNAL_METADATA_STALE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

function addIssue(
  issues: SemanticIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function parseTimestamp(
  value: string,
  path: string,
  issues: SemanticIssue[],
): number | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    addIssue(issues, "INVALID_TIMESTAMP", path, "Timestamp must be a valid ISO-8601 instant.");
    return null;
  }
  return parsed;
}

function expectedJakartaPeriod(month: string): { start: number; end: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const jakartaOffsetMs = 7 * 60 * 60 * 1000;
  return {
    start: Date.UTC(year, monthIndex, 1) - jakartaOffsetMs,
    end: Date.UTC(year, monthIndex + 1, 1) - jakartaOffsetMs,
  };
}

function validateCommon(
  snapshot: SnapshotHeader & { readonly data: unknown },
  options: SemanticValidationOptions,
  issues: SemanticIssue[],
): void {
  const asOf = parseTimestamp(options.asOf, "options.asOf", issues);
  const generatedAt = parseTimestamp(snapshot.generated_at, "generated_at", issues);
  const observedAt = parseTimestamp(snapshot.observed_at, "observed_at", issues);
  const startsAt = parseTimestamp(snapshot.reporting_period.starts_at, "reporting_period.starts_at", issues);
  const endsAt = parseTimestamp(
    snapshot.reporting_period.ends_at_exclusive,
    "reporting_period.ends_at_exclusive",
    issues,
  );

  if (options.futureToleranceMs < 0 || !Number.isFinite(options.futureToleranceMs)) {
    addIssue(
      issues,
      "INVALID_FUTURE_TOLERANCE",
      "options.futureToleranceMs",
      "Future tolerance must be a finite nonnegative duration.",
    );
  }

  if (generatedAt !== null && observedAt !== null && generatedAt < observedAt) {
    addIssue(
      issues,
      "GENERATED_BEFORE_OBSERVED",
      "generated_at",
      "generated_at must be greater than or equal to observed_at.",
    );
  }

  if (asOf !== null && Number.isFinite(options.futureToleranceMs)) {
    const latestAllowed = asOf + options.futureToleranceMs;
    if (observedAt !== null && observedAt > latestAllowed) {
      addIssue(issues, "OBSERVED_IN_FUTURE", "observed_at", "observed_at exceeds future tolerance.");
    }
    if (generatedAt !== null && generatedAt > latestAllowed) {
      addIssue(issues, "GENERATED_IN_FUTURE", "generated_at", "generated_at exceeds future tolerance.");
    }
  }

  if (startsAt !== null && endsAt !== null && startsAt >= endsAt) {
    addIssue(
      issues,
      "INVALID_REPORTING_PERIOD_CHRONOLOGY",
      "reporting_period",
      "Reporting period start must precede its exclusive end.",
    );
  }

  const expected = expectedJakartaPeriod(snapshot.reporting_period.month);
  if (
    expected === null ||
    startsAt !== expected.start ||
    endsAt !== expected.end ||
    snapshot.reporting_period.timezone !== "Asia/Jakarta"
  ) {
    addIssue(
      issues,
      "REPORTING_PERIOD_IDENTITY_MISMATCH",
      "reporting_period",
      "Reporting period boundaries must match its Asia/Jakarta month identity.",
    );
  }

  if (snapshot.snapshot_status === "UNKNOWN" && snapshot.data !== null) {
    addIssue(issues, "UNKNOWN_WITH_DATA", "data", "UNKNOWN snapshots must have null data.");
  }
  if (snapshot.snapshot_status !== "UNKNOWN" && snapshot.data === null) {
    addIssue(
      issues,
      "USABLE_STATUS_WITHOUT_DATA",
      "data",
      "AVAILABLE and EMPTY snapshots require an explicit data representation.",
    );
  }
}

function validateDetailWindow<T>(
  detail: DetailWindow<T>,
  path: string,
  issues: SemanticIssue[],
): void {
  if (detail.included_count !== detail.items.length) {
    addIssue(
      issues,
      "DETAIL_INCLUDED_COUNT_MISMATCH",
      `${path}.included_count`,
      "included_count must equal the number of included items.",
    );
  }
  if (detail.total_count < detail.included_count) {
    addIssue(
      issues,
      "DETAIL_TOTAL_COUNT_TOO_SMALL",
      `${path}.total_count`,
      "total_count cannot be smaller than included_count.",
    );
  }
  if (detail.truncated !== (detail.total_count > detail.included_count)) {
    addIssue(
      issues,
      "DETAIL_TRUNCATION_MISMATCH",
      `${path}.truncated`,
      "truncated must exactly indicate omitted detail items.",
    );
  }
}

function result(issues: SemanticIssue[]): SemanticValidationResult {
  return { valid: issues.length === 0, issues };
}

export function validateAccountingSnapshotSemantics(
  snapshot: AccountingSnapshot,
  options: SemanticValidationOptions,
): SemanticValidationResult {
  const issues: SemanticIssue[] = [];
  validateCommon(snapshot, options, issues);
  if (snapshot.data === null) {
    return result(issues);
  }

  const { summary } = snapshot.data;
  validateDetailWindow(snapshot.data.category_details, "data.category_details", issues);

  for (const [index, threshold] of snapshot.data.thresholds.entries()) {
    const expectedObserved = threshold.basis === "INCOME" ? summary.income_idr : summary.expense_idr;
    if (threshold.observed_idr !== expectedObserved) {
      addIssue(
        issues,
        "THRESHOLD_BASIS_MISMATCH",
        `data.thresholds.${index}.observed_idr`,
        "Threshold observed amount must match its documented summary basis.",
      );
    }

    const progress =
      (BigInt(threshold.observed_idr) * 10_000n) / BigInt(threshold.limit_idr);
    if (progress > MAX_SAFE_BIGINT || threshold.progress_basis_points !== Number(progress)) {
      addIssue(
        issues,
        "THRESHOLD_PROGRESS_MISMATCH",
        `data.thresholds.${index}.progress_basis_points`,
        "Threshold progress must be integer basis points derived from observed_idr / limit_idr.",
      );
    }
    if (threshold.reached !== (threshold.observed_idr >= threshold.limit_idr)) {
      addIssue(
        issues,
        "THRESHOLD_REACHED_MISMATCH",
        `data.thresholds.${index}.reached`,
        "Threshold reached flag must match observed_idr >= limit_idr.",
      );
    }
  }

  const assetKeys = new Set<string>();
  for (const [index, asset] of snapshot.data.asset_snapshots.entries()) {
    const path = `data.asset_snapshots.${index}`;
    const key = `${asset.asset_ref}\u0000${asset.period}`;
    if (assetKeys.has(key)) {
      addIssue(issues, "DUPLICATE_ASSET_PERIOD", path, "Asset reference and period must be unique.");
    }
    assetKeys.add(key);

    const dueAt = parseTimestamp(asset.due_at, `${path}.due_at`, issues);
    const graceUntil = parseTimestamp(asset.grace_until, `${path}.grace_until`, issues);
    if (dueAt !== null && graceUntil !== null && graceUntil < dueAt) {
      addIssue(
        issues,
        "GRACE_BEFORE_DUE",
        `${path}.grace_until`,
        "grace_until must be greater than or equal to due_at.",
      );
    }
    if (asset.period !== snapshot.reporting_period.month) {
      addIssue(
        issues,
        "ASSET_NOT_CURRENT_REPORTING_PERIOD",
        `${path}.period`,
        "Current-period asset snapshots must match the snapshot reporting period.",
      );
    }

    const expectedState = evaluateAssetCadence({
      period: asset.period,
      reportingPeriod: snapshot.reporting_period.month,
      dueAt: asset.due_at,
      graceUntil: asset.grace_until,
      capturedAt: asset.captured_at,
      asOf: options.asOf,
      snapshotStatus: snapshot.snapshot_status,
    });
    if (asset.state !== expectedState) {
      addIssue(
        issues,
        "ASSET_STATE_MISMATCH",
        `${path}.state`,
        `Asset state must be ${expectedState} for the supplied cadence inputs.`,
      );
    }
    if (asset.captured_late !== isCapturedLate(asset.captured_at, asset.grace_until)) {
      addIssue(
        issues,
        "CAPTURED_LATE_MISMATCH",
        `${path}.captured_late`,
        "captured_late must be derived from captured_at > grace_until.",
      );
    }
  }

  const historicalMissingPeriods = snapshot.data.asset_integrity.historical_missing_periods;
  if (
    snapshot.data.asset_integrity.historical_missing_period_count !== historicalMissingPeriods.length
  ) {
    addIssue(
      issues,
      "HISTORICAL_MISSING_COUNT_MISMATCH",
      "data.asset_integrity.historical_missing_period_count",
      "Historical missing count must equal the number of listed periods.",
    );
  }
  if (new Set(historicalMissingPeriods).size !== historicalMissingPeriods.length) {
    addIssue(
      issues,
      "DUPLICATE_HISTORICAL_MISSING_PERIOD",
      "data.asset_integrity.historical_missing_periods",
      "Historical missing periods must be unique.",
    );
  }
  if (historicalMissingPeriods.some((period) => period >= snapshot.reporting_period.month)) {
    addIssue(
      issues,
      "NON_HISTORICAL_MISSING_PERIOD",
      "data.asset_integrity.historical_missing_periods",
      "Historical missing periods must precede the current reporting period.",
    );
  }
  if (historicalMissingPeriods.length > 0 && snapshot.review_status !== "REVIEW_REQUIRED") {
    addIssue(
      issues,
      "HISTORICAL_MISSING_REQUIRES_REVIEW",
      "review_status",
      "Historical missing integrity conditions require review without changing current-period state.",
    );
  }

  if (snapshot.snapshot_status === "EMPTY") {
    const isZeroSummary =
      summary.income_idr === 0 &&
      summary.expense_idr === 0 &&
      summary.total_cash_outflow_idr === 0 &&
      summary.operational_surplus_idr === 0 &&
      summary.net_cash_surplus_idr === 0 &&
      summary.transaction_count === 0;
    if (
      !isZeroSummary ||
      snapshot.data.thresholds.length !== 0 ||
      snapshot.data.asset_snapshots.length !== 0 ||
      snapshot.data.asset_integrity.historical_missing_period_count !== 0 ||
      snapshot.data.asset_integrity.historical_missing_periods.length !== 0 ||
      snapshot.data.category_details.total_count !== 0
    ) {
      addIssue(
        issues,
        "EMPTY_ACCOUNTING_NOT_EMPTY",
        "data",
        "EMPTY accounting snapshots require zero summary values and empty detail collections.",
      );
    }
  }

  return result(issues);
}

const submissionStatuses: readonly SubmissionRecordedStatus[] = [
  "ACTIVE",
  "REVISION_REQUESTED",
  "ACCEPTED",
  "REJECTED",
];

export function validateSubmissionSnapshotSemantics(
  snapshot: SubmissionSnapshot,
  options: SemanticValidationOptions,
): SemanticValidationResult {
  const issues: SemanticIssue[] = [];
  validateCommon(snapshot, options, issues);
  if (snapshot.data === null) {
    return result(issues);
  }

  const detail = snapshot.data.paper_details;
  validateDetailWindow(detail, "data.paper_details", issues);
  const refs = new Set<string>();

  for (const [index, paper] of detail.items.entries()) {
    const path = `data.paper_details.items.${index}`;
    if (refs.has(paper.paper_ref)) {
      addIssue(issues, "DUPLICATE_PAPER_REF", `${path}.paper_ref`, "paper_ref must be unique.");
    }
    refs.add(paper.paper_ref);

    const isRevision = paper.recorded_status === "REVISION_REQUESTED";
    if (!isRevision && paper.revision_deadline !== null) {
      addIssue(
        issues,
        "DEADLINE_WITHOUT_REVISION",
        `${path}.revision_deadline`,
        "Only REVISION_REQUESTED records may carry a revision deadline.",
      );
    }
    if (paper.revision_deadline !== null) {
      if (paper.next_action?.kind !== "SUBMIT_REVISION") {
        addIssue(
          issues,
          "DEADLINE_ACTION_MISMATCH",
          `${path}.next_action`,
          "A revision deadline requires a SUBMIT_REVISION next action.",
        );
      }
      if (paper.next_action?.due_at !== paper.revision_deadline.due_at) {
        addIssue(
          issues,
          "DEADLINE_DATE_MISMATCH",
          `${path}.next_action.due_at`,
          "Revision action due_at must equal the authoritative revision deadline.",
        );
      }
    } else if (paper.next_action?.kind === "SUBMIT_REVISION" && paper.next_action.due_at !== null) {
      addIssue(
        issues,
        "UNSOURCED_REVISION_DEADLINE",
        `${path}.next_action.due_at`,
        "A revision due date cannot exist without a deadline source.",
      );
    }

    const isTerminal = paper.recorded_status === "ACCEPTED" || paper.recorded_status === "REJECTED";
    if (isTerminal && paper.decision_at === null) {
      addIssue(
        issues,
        "TERMINAL_STATUS_WITHOUT_DECISION",
        `${path}.decision_at`,
        "Accepted and rejected records require a recorded decision timestamp.",
      );
    }
    if (isTerminal && paper.next_action !== null) {
      addIssue(
        issues,
        "TERMINAL_STATUS_WITH_ACTION",
        `${path}.next_action`,
        "Accepted and rejected records must not invent a next action.",
      );
    }
    if (paper.evidence_completeness === "MISSING" && snapshot.review_status !== "REVIEW_REQUIRED") {
      addIssue(
        issues,
        "MISSING_EVIDENCE_REQUIRES_REVIEW",
        `${path}.evidence_completeness`,
        "Missing evidence requires REVIEW_REQUIRED without changing availability.",
      );
    }
  }

  const summary = snapshot.data.summary;
  const statusCounts = Object.fromEntries(
    submissionStatuses.map((status) => [
      status,
      detail.items.filter((paper) => paper.recorded_status === status).length,
    ]),
  ) as Record<SubmissionRecordedStatus, number>;
  const summaryStatusTotal =
    summary.active_count +
    summary.revision_requested_count +
    summary.accepted_count +
    summary.rejected_count;

  if (summary.total_count !== detail.total_count || summaryStatusTotal !== summary.total_count) {
    addIssue(
      issues,
      "SUBMISSION_SUMMARY_TOTAL_MISMATCH",
      "data.summary",
      "Summary status counts and detail total_count must equal total_count.",
    );
  }
  if (!detail.truncated) {
    if (
      summary.active_count !== statusCounts.ACTIVE ||
      summary.revision_requested_count !== statusCounts.REVISION_REQUESTED ||
      summary.accepted_count !== statusCounts.ACCEPTED ||
      summary.rejected_count !== statusCounts.REJECTED ||
      summary.no_next_action_count !== detail.items.filter((paper) => paper.next_action === null).length
    ) {
      addIssue(
        issues,
        "SUBMISSION_SUMMARY_DETAIL_MISMATCH",
        "data.summary",
        "Untruncated submission summaries must match their detail records.",
      );
    }
  }

  if (snapshot.snapshot_status === "EMPTY" && (summary.total_count !== 0 || detail.items.length !== 0)) {
    addIssue(
      issues,
      "EMPTY_SUBMISSION_NOT_EMPTY",
      "data",
      "EMPTY submission snapshots require zero summary and no papers.",
    );
  }

  return result(issues);
}

const issueCodes: readonly BankJournalIssueCode[] = [
  "UNRESOLVED_MAPPING",
  "INCOMPLETE_EVIDENCE",
  "EXTERNAL_METADATA_STALE",
  "SOURCE_CONFLICT",
];

export function validateBankJournalSnapshotSemantics(
  snapshot: BankJournalSnapshot,
  options: SemanticValidationOptions,
): SemanticValidationResult {
  const issues: SemanticIssue[] = [];
  validateCommon(snapshot, options, issues);
  if (snapshot.data === null) {
    return result(issues);
  }

  const detail = snapshot.data.issue_details;
  validateDetailWindow(detail, "data.issue_details", issues);
  const compositeKeys = new Set<string>();
  const asOf = parseTimestamp(options.asOf, "options.asOf", issues);

  for (const [index, issue] of detail.items.entries()) {
    const path = `data.issue_details.items.${index}`;
    const key = `${issue.paper_ref}\u0000${issue.subject_ref}\u0000${issue.issue_code}`;
    if (compositeKeys.has(key)) {
      addIssue(
        issues,
        "DUPLICATE_QUALITY_ISSUE",
        path,
        "Quality issue composite key paper_ref + subject_ref + issue_code must be unique.",
      );
    }
    compositeKeys.add(key);

    if (issue.issue_code === "EXTERNAL_METADATA_STALE") {
      if (issue.external_metadata_observed_at === null) {
        addIssue(
          issues,
          "STALE_METADATA_WITHOUT_TIMESTAMP",
          `${path}.external_metadata_observed_at`,
          "EXTERNAL_METADATA_STALE requires the metadata observation timestamp.",
        );
      } else {
        const observed = parseTimestamp(
          issue.external_metadata_observed_at,
          `${path}.external_metadata_observed_at`,
          issues,
        );
        if (asOf !== null && observed !== null && asOf - observed <= EXTERNAL_METADATA_STALE_AFTER_MS) {
          addIssue(
            issues,
            "METADATA_NOT_OLDER_THAN_90_DAYS",
            `${path}.external_metadata_observed_at`,
            "EXTERNAL_METADATA_STALE is valid only when metadata age is strictly greater than 90 days.",
          );
        }
      }
    } else if (issue.external_metadata_observed_at !== null) {
      addIssue(
        issues,
        "METADATA_TIMESTAMP_ON_UNRELATED_ISSUE",
        `${path}.external_metadata_observed_at`,
        "Only EXTERNAL_METADATA_STALE carries external metadata age evidence.",
      );
    }
  }

  if (detail.items.length > 0 && snapshot.review_status !== "REVIEW_REQUIRED") {
    addIssue(
      issues,
      "QUALITY_ISSUES_REQUIRE_REVIEW",
      "review_status",
      "Unresolved quality issues require REVIEW_REQUIRED without changing availability.",
    );
  }

  const summary = snapshot.data.summary;
  const counts = Object.fromEntries(
    issueCodes.map((code) => [code, detail.items.filter((issue) => issue.issue_code === code).length]),
  ) as Record<BankJournalIssueCode, number>;
  const summaryIssueTotal =
    summary.unresolved_mapping_count +
    summary.incomplete_evidence_count +
    summary.external_metadata_stale_count +
    summary.source_conflict_count;

  if (summary.quality_issue_count !== detail.total_count || summaryIssueTotal !== summary.quality_issue_count) {
    addIssue(
      issues,
      "BANK_SUMMARY_TOTAL_MISMATCH",
      "data.summary",
      "Issue summary counts and detail total_count must equal quality_issue_count.",
    );
  }
  if (!detail.truncated) {
    if (
      summary.unresolved_mapping_count !== counts.UNRESOLVED_MAPPING ||
      summary.incomplete_evidence_count !== counts.INCOMPLETE_EVIDENCE ||
      summary.external_metadata_stale_count !== counts.EXTERNAL_METADATA_STALE ||
      summary.source_conflict_count !== counts.SOURCE_CONFLICT
    ) {
      addIssue(
        issues,
        "BANK_SUMMARY_DETAIL_MISMATCH",
        "data.summary",
        "Untruncated issue summaries must match their detail records.",
      );
    }
  }

  if (snapshot.snapshot_status === "EMPTY" && (summary.quality_issue_count !== 0 || detail.items.length !== 0)) {
    addIssue(
      issues,
      "EMPTY_BANK_JOURNAL_NOT_EMPTY",
      "data",
      "EMPTY Bank Journal snapshots require zero summary and no quality issues.",
    );
  }

  return result(issues);
}
