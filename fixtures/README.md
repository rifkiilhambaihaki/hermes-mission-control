# Fixtures

All fixtures are synthetic and fictional. They contain no production names, identifiers, transactions, evidence, correspondence, or credentials.

Coverage modules:

- `snapshots/accounting-v2.cases.ts`
- `snapshots/submission-tracker.cases.ts`
- `snapshots/bank-journal-quality.cases.ts`
- `snapshots/privacy-canaries/prohibited-fields.json`

Fixture assembly helpers exist only inside test-data modules; they perform no I/O and are not snapshot generators. No fixture reads a live source.
