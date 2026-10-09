import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { accountingFixtures } from "../../fixtures/snapshots/accounting-v2.cases.js";
import { bankJournalFixtures } from "../../fixtures/snapshots/bank-journal-quality.cases.js";
import { submissionFixtures } from "../../fixtures/snapshots/submission-tracker.cases.js";
import { compileContractSchemas } from "../contracts/schema-harness.js";

const validators = compileContractSchemas();
const canaryPath = resolve(
  import.meta.dirname,
  "../../fixtures/snapshots/privacy-canaries/prohibited-fields.json",
);
const canaries = JSON.parse(readFileSync(canaryPath, "utf8")) as Record<string, unknown>;

function cloneRecord(value: unknown): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>;
}

describe("privacy canary boundaries", () => {
  it("contains only explicitly synthetic canary values", () => {
    expect(Object.keys(canaries)).toHaveLength(15);
    expect(JSON.stringify(canaries)).toContain("FAKE_");
    expect(JSON.stringify(canaries)).toContain("Synthetic");
  });

  it.each(Object.entries(canaries))("rejects prohibited Accounting field %s", (field, value) => {
    const snapshot = cloneRecord(accountingFixtures.validNormal);
    snapshot[field] = value;
    expect(validators.accounting(snapshot)).toBe(false);
  });

  it.each(Object.entries(canaries))("rejects prohibited Submission field %s", (field, value) => {
    const snapshot = cloneRecord(submissionFixtures.activeSubmission);
    snapshot[field] = value;
    expect(validators.submission(snapshot)).toBe(false);
  });

  it.each(Object.entries(canaries))("rejects prohibited Bank Journal field %s", (field, value) => {
    const snapshot = cloneRecord(bankJournalFixtures.normal);
    snapshot[field] = value;
    expect(validators.bankJournal(snapshot)).toBe(false);
  });

});
