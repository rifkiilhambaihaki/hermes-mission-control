import {
  GatewayObservationDescriptor,
  LocalGatewayObservationAdapter,
} from "../../adapters/hermes-gateway-local/index.js";
import {
  LocalHermesInstallationDescriptor,
  LocalHermesVersionMetadataAdapter,
} from "../../adapters/hermes-version-metadata/index.js";
import {
  LocalSchedulerObservationAdapter,
  SchedulerObservationDescriptor,
} from "../../adapters/hermes-scheduler-local/index.js";
import {
  AccountingSnapshotDescriptor,
  LocalAccountingV2SnapshotAdapter,
  type AccountingSnapshotObservationRequest,
} from "../../adapters/accounting-v2-snapshot/index.js";
import {
  LocalSubmissionTrackerSnapshotAdapter,
  SubmissionTrackerSnapshotDescriptor,
  type SubmissionTrackerSnapshotObservationRequest,
} from "../../adapters/submission-tracker-snapshot/index.js";
import {
  BankJournalQualitySnapshotDescriptor,
  LocalBankJournalQualitySnapshotAdapter,
  type BankJournalQualitySnapshotObservationRequest,
} from "../../adapters/bank-journal-quality-snapshot/index.js";
import { ObservationService } from "../../application/observations/observation-service.js";
import type { AccountingData, BankJournalData, SubmissionData } from "../../domain/contracts/snapshot-types.js";
import type { Observation } from "../../domain/observation/observation.js";
import type { LocalObservationPathConfig } from "../runtime-config.js";
import {
  createLocalObservationProviders,
  type LocalGatewayAdapterPort,
  type LocalSchedulerAdapterPort,
  type LocalVersionAdapterPort,
} from "./local-observation-providers.js";

const LOCAL_OBSERVATION_STALE_AFTER_MS = 30_000;
const LOCAL_OBSERVATION_EXPIRED_AFTER_MS = 60_000;
const ACCOUNTING_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;
const ACCOUNTING_EXPIRED_AFTER_MS = 72 * 60 * 60 * 1_000;
const ACCOUNTING_FUTURE_TOLERANCE_MS = 5 * 60 * 1_000;
const SUBMISSION_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1_000;
const SUBMISSION_EXPIRED_AFTER_MS = 30 * 24 * 60 * 60 * 1_000;
const SUBMISSION_FUTURE_TOLERANCE_MS = 5 * 60 * 1_000;
const BANK_JOURNAL_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1_000;
const BANK_JOURNAL_EXPIRED_AFTER_MS = 120 * 24 * 60 * 60 * 1_000;
const BANK_JOURNAL_FUTURE_TOLERANCE_MS = 5 * 60 * 1_000;

export interface AccountingSnapshotAdapterPort {
  observe(request: AccountingSnapshotObservationRequest): Promise<Observation<AccountingData>>;
}

export interface SubmissionTrackerSnapshotAdapterPort {
  observe(request: SubmissionTrackerSnapshotObservationRequest): Promise<Observation<SubmissionData>>;
}

export interface BankJournalQualitySnapshotAdapterPort {
  observe(request: BankJournalQualitySnapshotObservationRequest): Promise<Observation<BankJournalData>>;
}

export interface ProductionLocalObservationAdapters {
  readonly versionAdapter: LocalVersionAdapterPort;
  readonly gatewayAdapter: LocalGatewayAdapterPort;
  readonly schedulerAdapter: LocalSchedulerAdapterPort;
  readonly accountingAdapter: AccountingSnapshotAdapterPort;
  readonly bankJournalAdapter: BankJournalQualitySnapshotAdapterPort;
  readonly submissionAdapter: SubmissionTrackerSnapshotAdapterPort;
}

export interface LocalObservationServiceOptions {
  readonly clock: () => Date;
  readonly adapters: ProductionLocalObservationAdapters;
}

export function createLocalObservationService(
  options: LocalObservationServiceOptions,
): ObservationService {
  const localProviders = createLocalObservationProviders({
    clock: options.clock,
    staleAfterMs: LOCAL_OBSERVATION_STALE_AFTER_MS,
    expiredAfterMs: LOCAL_OBSERVATION_EXPIRED_AFTER_MS,
    versionAdapter: options.adapters.versionAdapter,
    gatewayAdapter: options.adapters.gatewayAdapter,
    schedulerAdapter: options.adapters.schedulerAdapter,
  });
  return new ObservationService({
    clock: options.clock,
    providers: {
      ...localProviders,
      ACCOUNTING_V2: async () => {
        const now = options.clock();
        if (!Number.isFinite(now.getTime())) throw new TypeError("Observation clock returned an invalid instant.");
        return options.adapters.accountingAdapter.observe({
          source: "ACCOUNTING_V2_LOCAL_SNAPSHOT",
          asOf: now.toISOString(),
          staleAfterMs: ACCOUNTING_STALE_AFTER_MS,
          expiredAfterMs: ACCOUNTING_EXPIRED_AFTER_MS,
          futureToleranceMs: ACCOUNTING_FUTURE_TOLERANCE_MS,
        });
      },
      BANK_JOURNAL: async () => {
        const now = options.clock();
        if (!Number.isFinite(now.getTime())) throw new TypeError("Observation clock returned an invalid instant.");
        return options.adapters.bankJournalAdapter.observe({
          source: "BANK_JOURNAL_QUALITY_LOCAL_SNAPSHOT",
          asOf: now.toISOString(),
          staleAfterMs: BANK_JOURNAL_STALE_AFTER_MS,
          expiredAfterMs: BANK_JOURNAL_EXPIRED_AFTER_MS,
          futureToleranceMs: BANK_JOURNAL_FUTURE_TOLERANCE_MS,
        });
      },
      SUBMISSION_TRACKER: async () => {
        const now = options.clock();
        if (!Number.isFinite(now.getTime())) throw new TypeError("Observation clock returned an invalid instant.");
        return options.adapters.submissionAdapter.observe({
          source: "SUBMISSION_TRACKER_LOCAL_SNAPSHOT",
          asOf: now.toISOString(),
          staleAfterMs: SUBMISSION_STALE_AFTER_MS,
          expiredAfterMs: SUBMISSION_EXPIRED_AFTER_MS,
          futureToleranceMs: SUBMISSION_FUTURE_TOLERANCE_MS,
        });
      },
    },
  });
}

export function createProductionLocalObservationService(
  configuration: LocalObservationPathConfig,
  clock: () => Date = () => new Date(),
): ObservationService {
  const versionDescriptor = LocalHermesInstallationDescriptor.fromApprovedServerConfiguration({
    sitePackagesRoot: configuration.sitePackagesRoot,
    distributionMetadataDirectory: configuration.distributionMetadataDirectory,
    editableSourceRoot: configuration.editableSourceRoot,
  });
  const gatewayDescriptor = GatewayObservationDescriptor.fromApprovedServerConfiguration({
    profileRoot: configuration.profileRoot,
    procRoot: configuration.procRoot,
  });
  const schedulerDescriptor = SchedulerObservationDescriptor.fromApprovedServerConfiguration({
    profileRoot: configuration.profileRoot,
  });
  const accountingDescriptor = AccountingSnapshotDescriptor.fromApprovedServerConfiguration({
    snapshotPath: configuration.accountingSnapshotPath,
    schemaRoot: configuration.schemaRoot,
  });
  const submissionDescriptor = SubmissionTrackerSnapshotDescriptor.fromApprovedServerConfiguration({
    snapshotPath: configuration.submissionSnapshotPath,
    schemaRoot: configuration.schemaRoot,
  });
  const bankJournalDescriptor = BankJournalQualitySnapshotDescriptor.fromApprovedServerConfiguration({
    snapshotPath: configuration.bankJournalSnapshotPath,
    schemaRoot: configuration.schemaRoot,
  });

  return createLocalObservationService({
    clock,
    adapters: {
      versionAdapter: new LocalHermesVersionMetadataAdapter(versionDescriptor),
      gatewayAdapter: new LocalGatewayObservationAdapter(gatewayDescriptor),
      schedulerAdapter: new LocalSchedulerObservationAdapter(schedulerDescriptor),
      accountingAdapter: new LocalAccountingV2SnapshotAdapter(accountingDescriptor),
      bankJournalAdapter: new LocalBankJournalQualitySnapshotAdapter(bankJournalDescriptor),
      submissionAdapter: new LocalSubmissionTrackerSnapshotAdapter(submissionDescriptor),
    },
  });
}
