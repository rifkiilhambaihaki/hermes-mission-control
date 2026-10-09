export type SnapshotStatus = "AVAILABLE" | "EMPTY" | "UNKNOWN";
export type ReviewStatus = "NONE" | "REVIEW_REQUIRED";

export interface ReportingPeriod {
  readonly month: string;
  readonly timezone: "Asia/Jakarta";
  readonly starts_at: string;
  readonly ends_at_exclusive: string;
}

export interface SnapshotHeader {
  readonly schema_version: "1.0.0";
  readonly source: string;
  readonly generated_at: string;
  readonly observed_at: string;
  readonly reporting_period: ReportingPeriod;
  readonly snapshot_status: SnapshotStatus;
  readonly review_status: ReviewStatus;
}

export interface DetailWindow<T> {
  readonly items: readonly T[];
  readonly included_count: number;
  readonly total_count: number;
  readonly truncated: boolean;
}

export type AssetCadenceState =
  | "CURRENT_PERIOD_NOT_DUE"
  | "CURRENT_PERIOD_DUE"
  | "CURRENT_PERIOD_CAPTURED"
  | "OVERDUE"
  | "UNKNOWN";

export interface AccountingSummary {
  readonly income_idr: number;
  readonly expense_idr: number;
  readonly total_cash_outflow_idr: number;
  readonly operational_surplus_idr: number;
  readonly net_cash_surplus_idr: number;
  readonly transaction_count: number;
}

export interface AccountingThreshold {
  readonly threshold_ref: string;
  readonly basis: "INCOME" | "EXPENSE";
  readonly limit_idr: number;
  readonly observed_idr: number;
  readonly progress_basis_points: number;
  readonly reached: boolean;
}

export interface AssetSnapshot {
  readonly asset_ref: string;
  readonly period: string;
  readonly due_at: string;
  readonly grace_until: string;
  readonly captured_at: string | null;
  readonly state: AssetCadenceState;
  readonly captured_late: boolean;
}

export interface AccountingCategory {
  readonly category_ref: string;
  readonly amount_idr: number;
  readonly transaction_count: number;
}

export interface AssetIntegrity {
  readonly historical_missing_period_count: number;
  readonly historical_missing_periods: readonly string[];
}

export interface AccountingData {
  readonly summary: AccountingSummary;
  readonly thresholds: readonly AccountingThreshold[];
  readonly asset_snapshots: readonly AssetSnapshot[];
  readonly asset_integrity: AssetIntegrity;
  readonly category_details: DetailWindow<AccountingCategory>;
}

export interface AccountingSnapshot extends SnapshotHeader {
  readonly source: "ACCOUNTING_V2";
  readonly currency: "IDR";
  readonly unit: "RUPIAH";
  readonly data: AccountingData | null;
}

export type SubmissionRecordedStatus =
  | "ACTIVE"
  | "REVISION_REQUESTED"
  | "ACCEPTED"
  | "REJECTED";

export interface RevisionDeadline {
  readonly due_at: string;
  readonly source: "EDITORIAL_NOTICE" | "SUBMISSION_SYSTEM" | "USER_CONFIRMED";
}

export interface SubmissionNextAction {
  readonly kind: "AWAIT_DECISION" | "SUBMIT_REVISION" | "FOLLOW_UP";
  readonly due_at: string | null;
}

export interface SubmissionPaper {
  readonly paper_ref: string;
  readonly recorded_status: SubmissionRecordedStatus;
  readonly authority: "SUBMISSION_HISTORY" | "PAPER_TRACKER";
  readonly evidence_completeness: "COMPLETE" | "MISSING";
  readonly submitted_at: string | null;
  readonly decision_at: string | null;
  readonly revision_deadline: RevisionDeadline | null;
  readonly next_action: SubmissionNextAction | null;
}

export interface SubmissionSummary {
  readonly total_count: number;
  readonly active_count: number;
  readonly revision_requested_count: number;
  readonly accepted_count: number;
  readonly rejected_count: number;
  readonly no_next_action_count: number;
}

export interface SubmissionData {
  readonly summary: SubmissionSummary;
  readonly paper_details: DetailWindow<SubmissionPaper>;
}

export interface SubmissionSnapshot extends SnapshotHeader {
  readonly source: "SUBMISSION_TRACKER";
  readonly data: SubmissionData | null;
}

export type BankJournalIssueCode =
  | "UNRESOLVED_MAPPING"
  | "INCOMPLETE_EVIDENCE"
  | "EXTERNAL_METADATA_STALE"
  | "SOURCE_CONFLICT";

export interface BankJournalQualityIssue {
  readonly paper_ref: string;
  readonly subject_ref: string;
  readonly issue_code: BankJournalIssueCode;
  readonly authority: "JOURNAL_KB" | "SUBMISSION_HISTORY" | "PAPER_TRACKER";
  readonly detected_at: string;
  readonly external_metadata_observed_at: string | null;
}

export interface BankJournalSummary {
  readonly quality_issue_count: number;
  readonly unresolved_mapping_count: number;
  readonly incomplete_evidence_count: number;
  readonly external_metadata_stale_count: number;
  readonly source_conflict_count: number;
}

export interface BankJournalData {
  readonly summary: BankJournalSummary;
  readonly issue_details: DetailWindow<BankJournalQualityIssue>;
}

export interface BankJournalSnapshot extends SnapshotHeader {
  readonly source: "BANK_JOURNAL_QUALITY";
  readonly data: BankJournalData | null;
}

export type SanitizedSnapshot =
  | AccountingSnapshot
  | SubmissionSnapshot
  | BankJournalSnapshot;
