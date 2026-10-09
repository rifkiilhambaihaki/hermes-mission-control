const period = {
  month: "2026-10",
  timezone: "Asia/Jakarta",
  starts_at: "2026-10-01T00:00:00+07:00",
  ends_at_exclusive: "2026-11-01T00:00:00+07:00",
} as const;

const header = {
  schema_version: "1.0.0",
  source: "BANK_JOURNAL_QUALITY",
  generated_at: "2026-10-20T09:00:00+07:00",
  observed_at: "2026-10-20T08:00:00+07:00",
  reporting_period: period,
  snapshot_status: "AVAILABLE",
  review_status: "REVIEW_REQUIRED",
} as const;

function dataFor(items: readonly unknown[], counts: {
  readonly unresolved: number;
  readonly incomplete: number;
  readonly stale: number;
  readonly conflict: number;
}) {
  return {
    summary: {
      quality_issue_count: items.length,
      unresolved_mapping_count: counts.unresolved,
      incomplete_evidence_count: counts.incomplete,
      external_metadata_stale_count: counts.stale,
      source_conflict_count: counts.conflict,
    },
    issue_details: {
      items,
      included_count: items.length,
      total_count: items.length,
      truncated: false,
    },
  };
}

const unresolvedIssue = {
  paper_ref: "PAPER-QUALITY-ALPHA",
  subject_ref: "FIELD-JOURNAL-ID",
  issue_code: "UNRESOLVED_MAPPING",
  authority: "JOURNAL_KB",
  detected_at: "2026-10-20T08:00:00+07:00",
  external_metadata_observed_at: null,
} as const;

export const bankJournalFixtureAsOf = "2026-10-20T10:00:00+07:00";

export const bankJournalFixtures: Readonly<Record<string, unknown>> = {
  normal: {
    ...header,
    review_status: "NONE",
    data: dataFor([], { unresolved: 0, incomplete: 0, stale: 0, conflict: 0 }),
  },
  unresolvedMapping: {
    ...header,
    data: dataFor([unresolvedIssue], { unresolved: 1, incomplete: 0, stale: 0, conflict: 0 }),
  },
  incompleteEvidence: {
    ...header,
    data: dataFor(
      [
        {
          paper_ref: "PAPER-QUALITY-BETA",
          subject_ref: "FIELD-EVIDENCE",
          issue_code: "INCOMPLETE_EVIDENCE",
          authority: "SUBMISSION_HISTORY",
          detected_at: "2026-10-20T08:00:00+07:00",
          external_metadata_observed_at: null,
        },
      ],
      { unresolved: 0, incomplete: 1, stale: 0, conflict: 0 },
    ),
  },
  externalMetadataExactly90Days: {
    ...header,
    data: dataFor(
      [
        {
          paper_ref: "PAPER-QUALITY-GAMMA",
          subject_ref: "FIELD-EXTERNAL-METADATA",
          issue_code: "EXTERNAL_METADATA_STALE",
          authority: "JOURNAL_KB",
          detected_at: "2026-10-20T00:00:00+07:00",
          external_metadata_observed_at: "2026-07-22T10:00:00+07:00",
        },
      ],
      { unresolved: 0, incomplete: 0, stale: 1, conflict: 0 },
    ),
  },
  externalMetadataOver90Days: {
    ...header,
    data: dataFor(
      [
        {
          paper_ref: "PAPER-QUALITY-DELTA",
          subject_ref: "FIELD-EXTERNAL-METADATA",
          issue_code: "EXTERNAL_METADATA_STALE",
          authority: "JOURNAL_KB",
          detected_at: "2026-10-20T00:00:00+07:00",
          external_metadata_observed_at: "2026-07-21T10:00:00+07:00",
        },
      ],
      { unresolved: 0, incomplete: 0, stale: 1, conflict: 0 },
    ),
  },
  sourceConflict: {
    ...header,
    data: dataFor(
      [
        {
          paper_ref: "PAPER-QUALITY-EPSILON",
          subject_ref: "FIELD-RECORDED-STATUS",
          issue_code: "SOURCE_CONFLICT",
          authority: "SUBMISSION_HISTORY",
          detected_at: "2026-10-20T08:00:00+07:00",
          external_metadata_observed_at: null,
        },
      ],
      { unresolved: 0, incomplete: 0, stale: 0, conflict: 1 },
    ),
  },
  duplicateQualityIssue: {
    ...header,
    data: dataFor(
      [unresolvedIssue, { ...unresolvedIssue }],
      { unresolved: 2, incomplete: 0, stale: 0, conflict: 0 },
    ),
  },
  invalidAuthority: {
    ...header,
    data: dataFor(
      [{ ...unresolvedIssue, authority: "UNAPPROVED_SOURCE" }],
      { unresolved: 1, incomplete: 0, stale: 0, conflict: 0 },
    ),
  },
  extraProperty: {
    ...header,
    data: dataFor(
      [{ ...unresolvedIssue, evidence_url: "https://invalid.example.test/evidence" }],
      { unresolved: 1, incomplete: 0, stale: 0, conflict: 0 },
    ),
  },
};
