const period = {
  month: "2026-10",
  timezone: "Asia/Jakarta",
  starts_at: "2026-10-01T00:00:00+07:00",
  ends_at_exclusive: "2026-11-01T00:00:00+07:00",
} as const;

const header = {
  schema_version: "1.0.0",
  source: "SUBMISSION_TRACKER",
  generated_at: "2026-10-20T09:00:00+07:00",
  observed_at: "2026-10-20T08:00:00+07:00",
  reporting_period: period,
  snapshot_status: "AVAILABLE",
  review_status: "NONE",
} as const;

const activePaper = {
  paper_ref: "PAPER-ALPHA",
  recorded_status: "ACTIVE",
  authority: "SUBMISSION_HISTORY",
  evidence_completeness: "COMPLETE",
  submitted_at: "2026-10-02T10:00:00+07:00",
  decision_at: null,
  revision_deadline: null,
  next_action: { kind: "AWAIT_DECISION", due_at: null },
} as const;

function dataFor(items: readonly unknown[], counts: {
  readonly active: number;
  readonly revision: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly noAction: number;
}) {
  return {
    summary: {
      total_count: items.length,
      active_count: counts.active,
      revision_requested_count: counts.revision,
      accepted_count: counts.accepted,
      rejected_count: counts.rejected,
      no_next_action_count: counts.noAction,
    },
    paper_details: {
      items,
      included_count: items.length,
      total_count: items.length,
      truncated: false,
    },
  };
}

export const submissionFixtureAsOf = "2026-10-20T10:00:00+07:00";

export const submissionFixtures: Readonly<Record<string, unknown>> = {
  activeSubmission: {
    ...header,
    data: dataFor([activePaper], { active: 1, revision: 0, accepted: 0, rejected: 0, noAction: 0 }),
  },
  revisionRequestedWithExplicitDeadline: {
    ...header,
    data: dataFor(
      [
        {
          paper_ref: "PAPER-BETA",
          recorded_status: "REVISION_REQUESTED",
          authority: "SUBMISSION_HISTORY",
          evidence_completeness: "COMPLETE",
          submitted_at: "2026-09-01T10:00:00+07:00",
          decision_at: "2026-10-10T10:00:00+07:00",
          revision_deadline: {
            due_at: "2026-11-10T23:59:00+07:00",
            source: "EDITORIAL_NOTICE",
          },
          next_action: { kind: "SUBMIT_REVISION", due_at: "2026-11-10T23:59:00+07:00" },
        },
      ],
      { active: 0, revision: 1, accepted: 0, rejected: 0, noAction: 0 },
    ),
  },
  missingEvidence: {
    ...header,
    review_status: "REVIEW_REQUIRED",
    data: dataFor(
      [
        {
          paper_ref: "PAPER-GAMMA",
          recorded_status: "REVISION_REQUESTED",
          authority: "PAPER_TRACKER",
          evidence_completeness: "MISSING",
          submitted_at: "2026-09-05T10:00:00+07:00",
          decision_at: "2026-10-12T10:00:00+07:00",
          revision_deadline: null,
          next_action: { kind: "SUBMIT_REVISION", due_at: null },
        },
      ],
      { active: 0, revision: 1, accepted: 0, rejected: 0, noAction: 0 },
    ),
  },
  acceptedAndRejectedRecorded: {
    ...header,
    data: dataFor(
      [
        {
          paper_ref: "PAPER-DELTA",
          recorded_status: "ACCEPTED",
          authority: "SUBMISSION_HISTORY",
          evidence_completeness: "COMPLETE",
          submitted_at: "2026-08-01T10:00:00+07:00",
          decision_at: "2026-10-11T10:00:00+07:00",
          revision_deadline: null,
          next_action: null,
        },
        {
          paper_ref: "PAPER-EPSILON",
          recorded_status: "REJECTED",
          authority: "SUBMISSION_HISTORY",
          evidence_completeness: "COMPLETE",
          submitted_at: "2026-08-03T10:00:00+07:00",
          decision_at: "2026-10-13T10:00:00+07:00",
          revision_deadline: null,
          next_action: null,
        },
      ],
      { active: 0, revision: 0, accepted: 1, rejected: 1, noAction: 2 },
    ),
  },
  noNextAction: {
    ...header,
    data: dataFor(
      [{ ...activePaper, paper_ref: "PAPER-ZETA", next_action: null }],
      { active: 1, revision: 0, accepted: 0, rejected: 0, noAction: 1 },
    ),
  },
  empty: {
    ...header,
    snapshot_status: "EMPTY",
    data: dataFor([], { active: 0, revision: 0, accepted: 0, rejected: 0, noAction: 0 }),
  },
  unknown: {
    ...header,
    snapshot_status: "UNKNOWN",
    review_status: "REVIEW_REQUIRED",
    data: null,
  },
  duplicatePaperReference: {
    ...header,
    data: dataFor(
      [activePaper, { ...activePaper }],
      { active: 2, revision: 0, accepted: 0, rejected: 0, noAction: 0 },
    ),
  },
  invalidAuthority: {
    ...header,
    data: dataFor(
      [{ ...activePaper, authority: "SPECULATIVE_SOURCE" }],
      { active: 1, revision: 0, accepted: 0, rejected: 0, noAction: 0 },
    ),
  },
  invalidSpeculativeField: {
    ...header,
    data: dataFor(
      [{ ...activePaper, predicted_acceptance: true }],
      { active: 1, revision: 0, accepted: 0, rejected: 0, noAction: 0 },
    ),
  },
  unknownExtraProperty: {
    ...header,
    data: dataFor([activePaper], { active: 1, revision: 0, accepted: 0, rejected: 0, noAction: 0 }),
    manuscript_text: "Synthetic prohibited content",
  },
};
