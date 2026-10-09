import { describe, expect, it } from "vitest";

import {
  accountingFixtureAsOf,
  accountingFixtures,
} from "../../fixtures/snapshots/accounting-v2.cases.js";
import {
  bankJournalFixtureAsOf,
  bankJournalFixtures,
} from "../../fixtures/snapshots/bank-journal-quality.cases.js";
import {
  submissionFixtureAsOf,
  submissionFixtures,
} from "../../fixtures/snapshots/submission-tracker.cases.js";
import {
  validateAccountingSnapshotSemantics,
  validateBankJournalSnapshotSemantics,
  validateSubmissionSnapshotSemantics,
} from "../../src/domain/contracts/semantic-validation.js";
import type {
  AccountingSnapshot,
  BankJournalSnapshot,
  SubmissionSnapshot,
} from "../../src/domain/contracts/snapshot-types.js";

const tolerance = 5 * 60 * 1000;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function accounting(name: string): AccountingSnapshot {
  return accountingFixtures[name] as AccountingSnapshot;
}

function submission(name: string): SubmissionSnapshot {
  return submissionFixtures[name] as SubmissionSnapshot;
}

function bank(name: string): BankJournalSnapshot {
  return bankJournalFixtures[name] as BankJournalSnapshot;
}

describe("snapshot semantic validators", () => {
  it.each([
    "validNormal",
    "availableReviewRequired",
    "empty",
    "unknown",
    "assetCurrentPeriodNotDue",
    "assetCurrentPeriodDue",
    "assetCurrentPeriodCaptured",
    "assetCapturedLate",
    "assetOverdue",
    "historicalMissingWithCurrentDue",
    "safeIntegerBoundary",
  ])("accepts Accounting semantic fixture %s", (name) => {
    const result = validateAccountingSnapshotSemantics(accounting(name), {
      asOf: accountingFixtureAsOf,
      futureToleranceMs: tolerance,
    });
    expect(result.issues).toEqual([]);
  });

  it.each([
    ["invalidReportingPeriod", "REPORTING_PERIOD_IDENTITY_MISMATCH"],
    ["invalidCadenceTimestamps", "GRACE_BEFORE_DUE"],
  ])("rejects Accounting semantic fixture %s", (name, expectedCode) => {
    const result = validateAccountingSnapshotSemantics(accounting(name), {
      asOf: accountingFixtureAsOf,
      futureToleranceMs: tolerance,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(expectedCode);
  });

  it.each([
    ["assetCurrentPeriodNotDue", "CURRENT_PERIOD_NOT_DUE"],
    ["assetCurrentPeriodDue", "CURRENT_PERIOD_DUE"],
    ["assetCurrentPeriodCaptured", "CURRENT_PERIOD_CAPTURED"],
    ["assetOverdue", "OVERDUE"],
  ])(
    "keeps %s current state when historical integrity is missing",
    (fixtureName, expectedState) => {
      const snapshot = clone(accounting(fixtureName)) as unknown as {
        review_status: "NONE" | "REVIEW_REQUIRED";
        data: {
          asset_integrity: {
            historical_missing_period_count: number;
            historical_missing_periods: string[];
          };
          asset_snapshots: Array<{ state: string }>;
        };
      };
      snapshot.review_status = "REVIEW_REQUIRED";
      snapshot.data.asset_integrity = {
        historical_missing_period_count: 1,
        historical_missing_periods: ["2026-09"],
      };

      const result = validateAccountingSnapshotSemantics(snapshot as unknown as AccountingSnapshot, {
        asOf: accountingFixtureAsOf,
        futureToleranceMs: tolerance,
      });
      expect(result.issues).toEqual([]);
      expect(snapshot.data.asset_snapshots[0]?.state).toBe(expectedState);
      expect(snapshot.data.asset_integrity.historical_missing_period_count).toBe(1);
      expect(snapshot.review_status).toBe("REVIEW_REQUIRED");
    },
  );

  it("requires review for orthogonal historical missing integrity", () => {
    const snapshot = clone(accounting("assetCurrentPeriodNotDue")) as unknown as {
      data: {
        asset_integrity: {
          historical_missing_period_count: number;
          historical_missing_periods: string[];
        };
      };
    };
    snapshot.data.asset_integrity = {
      historical_missing_period_count: 1,
      historical_missing_periods: ["2026-09"],
    };
    const result = validateAccountingSnapshotSemantics(snapshot as unknown as AccountingSnapshot, {
      asOf: accountingFixtureAsOf,
      futureToleranceMs: tolerance,
    });
    expect(result.issues.map((issue) => issue.code)).toContain("HISTORICAL_MISSING_REQUIRES_REVIEW");
  });

  it("transports canonical Accounting aggregates without generic surplus recomputation", () => {
    const snapshot = accounting("validNormal");
    const summary = snapshot.data!.summary;
    expect(summary.operational_surplus_idr).not.toBe(summary.income_idr - summary.expense_idr);
    expect(summary.net_cash_surplus_idr).not.toBe(summary.income_idr - summary.expense_idr);
    expect(summary.total_cash_outflow_idr).not.toBe(summary.expense_idr);

    const result = validateAccountingSnapshotSemantics(snapshot, {
      asOf: accountingFixtureAsOf,
      futureToleranceMs: tolerance,
    });
    expect(result.issues).toEqual([]);
  });

  it("rejects threshold progress inconsistent with its documented basis", () => {
    const snapshot = clone(accounting("validNormal"));
    const threshold = snapshot.data!.thresholds[0]! as { progress_basis_points: number };
    threshold.progress_basis_points = 4_052;
    const result = validateAccountingSnapshotSemantics(snapshot, {
      asOf: accountingFixtureAsOf,
      futureToleranceMs: tolerance,
    });
    expect(result.issues.map((issue) => issue.code)).toContain("THRESHOLD_PROGRESS_MISMATCH");
  });

  it("enforces generated_at >= observed_at and explicit future tolerance", () => {
    const chronology = clone(accounting("validNormal")) as AccountingSnapshot & {
      generated_at: string;
    };
    chronology.generated_at = "2026-10-20T07:00:00+07:00";
    expect(
      validateAccountingSnapshotSemantics(chronology, {
        asOf: accountingFixtureAsOf,
        futureToleranceMs: tolerance,
      }).issues.map((issue) => issue.code),
    ).toContain("GENERATED_BEFORE_OBSERVED");

    const future = clone(accounting("validNormal")) as AccountingSnapshot & {
      generated_at: string;
    };
    future.generated_at = "2026-10-20T10:06:00+07:00";
    expect(
      validateAccountingSnapshotSemantics(future, {
        asOf: accountingFixtureAsOf,
        futureToleranceMs: tolerance,
      }).issues.map((issue) => issue.code),
    ).toContain("GENERATED_IN_FUTURE");
  });

  it.each([
    "activeSubmission",
    "revisionRequestedWithExplicitDeadline",
    "missingEvidence",
    "acceptedAndRejectedRecorded",
    "noNextAction",
    "empty",
    "unknown",
  ])("accepts Submission semantic fixture %s", (name) => {
    const result = validateSubmissionSnapshotSemantics(submission(name), {
      asOf: submissionFixtureAsOf,
      futureToleranceMs: tolerance,
    });
    expect(result.issues).toEqual([]);
  });

  it("rejects duplicate paper_ref", () => {
    const result = validateSubmissionSnapshotSemantics(submission("duplicatePaperReference"), {
      asOf: submissionFixtureAsOf,
      futureToleranceMs: tolerance,
    });
    expect(result.issues.map((issue) => issue.code)).toContain("DUPLICATE_PAPER_REF");
  });

  it("keeps revision deadline and sourced next-action date consistent", () => {
    const snapshot = clone(submission("revisionRequestedWithExplicitDeadline"));
    const paper = snapshot.data!.paper_details.items[0]! as {
      next_action: { due_at: string };
    };
    paper.next_action.due_at = "2026-11-11T23:59:00+07:00";
    const result = validateSubmissionSnapshotSemantics(snapshot, {
      asOf: submissionFixtureAsOf,
      futureToleranceMs: tolerance,
    });
    expect(result.issues.map((issue) => issue.code)).toContain("DEADLINE_DATE_MISMATCH");
  });

  it.each(["normal", "unresolvedMapping", "incompleteEvidence", "externalMetadataOver90Days", "sourceConflict"])(
    "accepts Bank Journal semantic fixture %s",
    (name) => {
      const result = validateBankJournalSnapshotSemantics(bank(name), {
        asOf: bankJournalFixtureAsOf,
        futureToleranceMs: tolerance,
      });
      expect(result.issues).toEqual([]);
    },
  );

  it("requires EXTERNAL_METADATA_STALE age to be strictly greater than 90 days", () => {
    const exactly90 = validateBankJournalSnapshotSemantics(bank("externalMetadataExactly90Days"), {
      asOf: bankJournalFixtureAsOf,
      futureToleranceMs: tolerance,
    });
    expect(exactly90.issues.map((issue) => issue.code)).toContain("METADATA_NOT_OLDER_THAN_90_DAYS");

    const over90 = validateBankJournalSnapshotSemantics(bank("externalMetadataOver90Days"), {
      asOf: bankJournalFixtureAsOf,
      futureToleranceMs: tolerance,
    });
    expect(over90.valid).toBe(true);
  });

  it("rejects duplicate Bank Journal quality issue composite keys", () => {
    const result = validateBankJournalSnapshotSemantics(bank("duplicateQualityIssue"), {
      asOf: bankJournalFixtureAsOf,
      futureToleranceMs: tolerance,
    });
    expect(result.issues.map((issue) => issue.code)).toContain("DUPLICATE_QUALITY_ISSUE");
  });

  it("requires summary, detail counts, and truncated flag to agree", () => {
    const snapshot = clone(bank("unresolvedMapping"));
    const detail = snapshot.data!.issue_details as {
      total_count: number;
      truncated: boolean;
    };
    detail.total_count = 2;
    detail.truncated = false;
    const result = validateBankJournalSnapshotSemantics(snapshot, {
      asOf: bankJournalFixtureAsOf,
      futureToleranceMs: tolerance,
    });
    expect(result.issues.map((issue) => issue.code)).toContain("DETAIL_TRUNCATION_MISMATCH");
  });
});
