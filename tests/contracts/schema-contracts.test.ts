import { describe, expect, it } from "vitest";

import { accountingFixtures } from "../../fixtures/snapshots/accounting-v2.cases.js";
import { bankJournalFixtures } from "../../fixtures/snapshots/bank-journal-quality.cases.js";
import { submissionFixtures } from "../../fixtures/snapshots/submission-tracker.cases.js";
import { compileContractSchemas } from "./schema-harness.js";

const validators = compileContractSchemas();

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("JSON Schema snapshot contracts", () => {
  it("compiles every frozen schema under Ajv Draft 2020-12", () => {
    expect(validators.accounting).toBeTypeOf("function");
    expect(validators.submission).toBeTypeOf("function");
    expect(validators.bankJournal).toBeTypeOf("function");

  });

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
    "invalidReportingPeriod",
    "invalidCadenceTimestamps",
    "safeIntegerBoundary",
  ])("accepts structurally valid Accounting fixture %s", (name) => {
    expect(validators.accounting(accountingFixtures[name])).toBe(true);
  });

  it.each(["invalidMonetaryType", "unknownField", "oversizedInteger"])(
    "rejects structurally invalid Accounting fixture %s",
    (name) => {
      expect(validators.accounting(accountingFixtures[name])).toBe(false);
    },
  );

  it.each([
    "activeSubmission",
    "revisionRequestedWithExplicitDeadline",
    "missingEvidence",
    "acceptedAndRejectedRecorded",
    "noNextAction",
    "empty",
    "unknown",
    "duplicatePaperReference",
  ])("accepts structurally valid Submission fixture %s", (name) => {
    expect(validators.submission(submissionFixtures[name])).toBe(true);
  });

  it.each(["invalidAuthority", "invalidSpeculativeField", "unknownExtraProperty"])(
    "rejects structurally invalid Submission fixture %s",
    (name) => {
      expect(validators.submission(submissionFixtures[name])).toBe(false);
    },
  );

  it.each([
    "normal",
    "unresolvedMapping",
    "incompleteEvidence",
    "externalMetadataExactly90Days",
    "externalMetadataOver90Days",
    "sourceConflict",
    "duplicateQualityIssue",
  ])("accepts structurally valid Bank Journal fixture %s", (name) => {
    expect(validators.bankJournal(bankJournalFixtures[name])).toBe(true);
  });

  it.each(["invalidAuthority", "extraProperty"])(
    "rejects structurally invalid Bank Journal fixture %s",
    (name) => {
      expect(validators.bankJournal(bankJournalFixtures[name])).toBe(false);
    },
  );

  it("keeps snapshot status and review status orthogonal", () => {
    expect(validators.accounting(accountingFixtures.availableReviewRequired)).toBe(true);
    expect(validators.accounting(accountingFixtures.unknown)).toBe(true);
  });

  it("does not allow snapshots to self-declare UNAVAILABLE", () => {
    const snapshot = clone(accountingFixtures.validNormal) as Record<string, unknown>;
    snapshot.snapshot_status = "UNAVAILABLE";
    expect(validators.accounting(snapshot)).toBe(false);
  });

  it("uses canonical whole-rupiah aggregate fields without amount_minor", () => {
    const snapshot = accountingFixtures.validNormal as {
      readonly data: {
        readonly summary: {
          readonly expense_idr: number;
          readonly total_cash_outflow_idr: number;
          readonly operational_surplus_idr: number;
          readonly net_cash_surplus_idr: number;
        };
      };
    };
    expect(snapshot.data.summary.expense_idr).toBe(202_555);
    expect(snapshot.data.summary.total_cash_outflow_idr).toBe(350_000);
    expect(snapshot.data.summary.operational_surplus_idr).toBe(900_000);
    expect(snapshot.data.summary.net_cash_surplus_idr).toBe(650_000);
    expect(JSON.stringify(snapshot)).not.toContain("amount_minor");
    expect(validators.accounting(snapshot)).toBe(true);
  });

});
