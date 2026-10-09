# Schemas

Executable JSON Schema contracts for sanitized local snapshots.

- `common.snapshot.defs.schema.json`: shared status, timestamp, reporting-period, safe-integer, and detail-window definitions.
- `accounting_v2.snapshot.schema.json`: Accounting V2 aggregate-only sanitized snapshot.
- `submission_tracker.snapshot.schema.json`: Submission Tracker sanitized snapshot.
- `bank_journal_quality.snapshot.schema.json`: Bank Journal quality-only sanitized snapshot.
All schemas use JSON Schema Draft 2020-12, reject unknown properties at privacy-sensitive object boundaries, and keep `snapshot_status` separate from `review_status`. The live aggregate HTTP contract is defined and validated in `src/http/contracts.ts` and mirrored by the strict browser validator in `src/web/api.ts`.
