const period = {
  month: "2026-10",
  timezone: "Asia/Jakarta",
  starts_at: "2026-10-01T00:00:00+07:00",
  ends_at_exclusive: "2026-11-01T00:00:00+07:00",
} as const;

const normalData = {
  summary: {
    income_idr: 1_000_000,
    expense_idr: 202_555,
    total_cash_outflow_idr: 350_000,
    operational_surplus_idr: 900_000,
    net_cash_surplus_idr: 650_000,
    transaction_count: 2,
  },
  thresholds: [
    {
      threshold_ref: "MONTHLY_EXPENSE",
      basis: "EXPENSE",
      limit_idr: 500_000,
      observed_idr: 202_555,
      progress_basis_points: 4_051,
      reached: false,
    },
  ],
  asset_snapshots: [],
  asset_integrity: {
    historical_missing_period_count: 0,
    historical_missing_periods: [],
  },
  category_details: {
    items: [{ category_ref: "SYNTHETIC_CATEGORY", amount_idr: 202_555, transaction_count: 2 }],
    included_count: 1,
    total_count: 1,
    truncated: false,
  },
} as const;

const header = {
  schema_version: "1.0.0",
  source: "ACCOUNTING_V2",
  generated_at: "2026-10-20T09:00:00+07:00",
  observed_at: "2026-10-20T08:00:00+07:00",
  reporting_period: period,
  snapshot_status: "AVAILABLE",
  review_status: "NONE",
  currency: "IDR",
  unit: "RUPIAH",
} as const;

export const accountingFixtureAsOf = "2026-10-20T10:00:00+07:00";

export const accountingFixtures: Readonly<Record<string, unknown>> = {
  validNormal: { ...header, data: normalData },
  availableReviewRequired: {
    ...header,
    review_status: "REVIEW_REQUIRED",
    data: normalData,
  },
  empty: {
    ...header,
    snapshot_status: "EMPTY",
    data: {
      summary: {
        income_idr: 0,
        expense_idr: 0,
        total_cash_outflow_idr: 0,
        operational_surplus_idr: 0,
        net_cash_surplus_idr: 0,
        transaction_count: 0,
      },
      thresholds: [],
      asset_snapshots: [],
      asset_integrity: {
        historical_missing_period_count: 0,
        historical_missing_periods: [],
      },
      category_details: { items: [], included_count: 0, total_count: 0, truncated: false },
    },
  },
  unknown: {
    ...header,
    snapshot_status: "UNKNOWN",
    review_status: "REVIEW_REQUIRED",
    data: null,
  },
  assetCurrentPeriodNotDue: {
    ...header,
    data: {
      ...normalData,
      asset_snapshots: [
        {
          asset_ref: "ASSET-MONTHLY",
          period: "2026-10",
          due_at: "2026-10-25T00:00:00+07:00",
          grace_until: "2026-10-27T00:00:00+07:00",
          captured_at: null,
          state: "CURRENT_PERIOD_NOT_DUE",
          captured_late: false,
        },
      ],
    },
  },
  assetCurrentPeriodDue: {
    ...header,
    data: {
      ...normalData,
      asset_snapshots: [
        {
          asset_ref: "ASSET-MONTHLY",
          period: "2026-10",
          due_at: "2026-10-15T00:00:00+07:00",
          grace_until: "2026-10-25T00:00:00+07:00",
          captured_at: null,
          state: "CURRENT_PERIOD_DUE",
          captured_late: false,
        },
      ],
    },
  },
  assetCurrentPeriodCaptured: {
    ...header,
    data: {
      ...normalData,
      asset_snapshots: [
        {
          asset_ref: "ASSET-MONTHLY",
          period: "2026-10",
          due_at: "2026-10-15T00:00:00+07:00",
          grace_until: "2026-10-25T00:00:00+07:00",
          captured_at: "2026-10-18T00:00:00+07:00",
          state: "CURRENT_PERIOD_CAPTURED",
          captured_late: false,
        },
      ],
    },
  },
  assetCapturedLate: {
    ...header,
    data: {
      ...normalData,
      asset_snapshots: [
        {
          asset_ref: "ASSET-MONTHLY",
          period: "2026-10",
          due_at: "2026-10-10T00:00:00+07:00",
          grace_until: "2026-10-15T00:00:00+07:00",
          captured_at: "2026-10-18T00:00:00+07:00",
          state: "CURRENT_PERIOD_CAPTURED",
          captured_late: true,
        },
      ],
    },
  },
  assetOverdue: {
    ...header,
    data: {
      ...normalData,
      asset_snapshots: [
        {
          asset_ref: "ASSET-MONTHLY",
          period: "2026-10",
          due_at: "2026-10-10T00:00:00+07:00",
          grace_until: "2026-10-15T00:00:00+07:00",
          captured_at: null,
          state: "OVERDUE",
          captured_late: false,
        },
      ],
    },
  },
  historicalMissingWithCurrentDue: {
    ...header,
    review_status: "REVIEW_REQUIRED",
    data: {
      ...normalData,
      asset_integrity: {
        historical_missing_period_count: 1,
        historical_missing_periods: ["2026-09"],
      },
      asset_snapshots: [
        {
          asset_ref: "ASSET-MONTHLY",
          period: "2026-10",
          due_at: "2026-10-15T00:00:00+07:00",
          grace_until: "2026-10-25T00:00:00+07:00",
          captured_at: null,
          state: "CURRENT_PERIOD_DUE",
          captured_late: false,
        },
      ],
    },
  },
  invalidMonetaryType: {
    ...header,
    data: {
      ...normalData,
      summary: { ...normalData.summary, expense_idr: "202555" },
    },
  },
  invalidReportingPeriod: {
    ...header,
    reporting_period: { ...period, starts_at: "2026-10-02T00:00:00+07:00" },
    data: normalData,
  },
  invalidCadenceTimestamps: {
    ...header,
    data: {
      ...normalData,
      asset_snapshots: [
        {
          asset_ref: "ASSET-MONTHLY",
          period: "2026-10",
          due_at: "2026-10-20T00:00:00+07:00",
          grace_until: "2026-10-19T00:00:00+07:00",
          captured_at: null,
          state: "CURRENT_PERIOD_DUE",
          captured_late: false,
        },
      ],
    },
  },
  unknownField: { ...header, data: normalData, transaction_description: "synthetic prohibited detail" },
  safeIntegerBoundary: {
    ...header,
    data: {
      summary: {
        income_idr: Number.MAX_SAFE_INTEGER,
        expense_idr: 0,
        total_cash_outflow_idr: Number.MAX_SAFE_INTEGER,
        operational_surplus_idr: -Number.MAX_SAFE_INTEGER,
        net_cash_surplus_idr: Number.MAX_SAFE_INTEGER,
        transaction_count: 0,
      },
      thresholds: [],
      asset_snapshots: [],
      asset_integrity: {
        historical_missing_period_count: 0,
        historical_missing_periods: [],
      },
      category_details: { items: [], included_count: 0, total_count: 0, truncated: false },
    },
  },
  oversizedInteger: {
    ...header,
    data: {
      ...normalData,
      summary: { ...normalData.summary, income_idr: 9_007_199_254_740_992 },
    },
  },
};
