import {
  localVersionMetadataResultToObservation,
  type LocalVersionMetadataResult,
} from "../../adapters/hermes-version-metadata/index.js";
import type { GatewayObservationRequest } from "../../adapters/hermes-gateway-local/index.js";
import type { SchedulerObservationRequest } from "../../adapters/hermes-scheduler-local/index.js";
import type { GatewayObservationData } from "../../domain/gateway/gateway-observation.js";
import type { Observation } from "../../domain/observation/observation.js";
import type { SchedulerData } from "../../domain/scheduler/scheduler-observation.js";
import type { ObservationProviderMap } from "../../application/observations/observation-service.js";

export interface LocalVersionAdapterPort {
  read(): Promise<LocalVersionMetadataResult>;
}

export interface LocalGatewayAdapterPort {
  observe(request: GatewayObservationRequest): Promise<Observation<GatewayObservationData>>;
}

export interface LocalSchedulerAdapterPort {
  observe(request: SchedulerObservationRequest): Promise<Observation<SchedulerData>>;
}

export interface LocalObservationProviderOptions {
  readonly clock: () => Date;
  readonly staleAfterMs: number;
  readonly expiredAfterMs: number;
  readonly versionAdapter: LocalVersionAdapterPort;
  readonly gatewayAdapter: LocalGatewayAdapterPort;
  readonly schedulerAdapter: LocalSchedulerAdapterPort;
}

type LocalProviderMap = Pick<
  ObservationProviderMap,
  "HERMES_VERSION" | "HERMES_GATEWAY" | "HERMES_SCHEDULER"
>;

function validateThresholds(staleAfterMs: number, expiredAfterMs: number): void {
  if (
    !Number.isFinite(staleAfterMs) ||
    !Number.isFinite(expiredAfterMs) ||
    staleAfterMs < 0 ||
    expiredAfterMs < staleAfterMs
  ) {
    throw new TypeError("Observation freshness thresholds are invalid.");
  }
}

function timestamp(clock: () => Date): string {
  const now = clock();
  if (!Number.isFinite(now.getTime())) throw new TypeError("Observation clock returned an invalid instant.");
  return now.toISOString();
}

export function createLocalObservationProviders(
  options: LocalObservationProviderOptions,
): LocalProviderMap {
  validateThresholds(options.staleAfterMs, options.expiredAfterMs);
  return Object.freeze({
    HERMES_VERSION: async () => {
      const observedAt = timestamp(options.clock);
      return localVersionMetadataResultToObservation(await options.versionAdapter.read(), {
        source: "HERMES_VERSION_METADATA",
        observedAt,
        fetchedAt: observedAt,
      });
    },
    HERMES_GATEWAY: async () => {
      const observedAt = timestamp(options.clock);
      return options.gatewayAdapter.observe({
        source: "HERMES_GATEWAY_LOCAL",
        observedAt,
        fetchedAt: observedAt,
        asOf: observedAt,
        staleAfterMs: options.staleAfterMs,
        expiredAfterMs: options.expiredAfterMs,
      });
    },
    HERMES_SCHEDULER: async () => {
      const observedAt = timestamp(options.clock);
      return options.schedulerAdapter.observe({
        source: "HERMES_SCHEDULER_LOCAL",
        observedAt,
        fetchedAt: observedAt,
        asOf: observedAt,
        staleAfterMs: options.staleAfterMs,
        expiredAfterMs: options.expiredAfterMs,
      });
    },
  });
}
