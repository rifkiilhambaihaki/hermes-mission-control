export {
  GATEWAY_PID_RECORD_MAX_BYTES,
  LOCAL_GATEWAY_OBSERVATION_ADAPTER_VERSION,
  PROCESS_STAT_MAX_BYTES,
  GatewayObservationDescriptor,
  LocalGatewayObservationAdapter,
  type ApprovedGatewayObservationConfiguration,
  type GatewayObservationErrorCode,
  type GatewayObservationRequest,
} from "./local-gateway-observation-adapter.js";

export type {
  GatewayDuplicateDefinitionState,
  GatewayManagerCategory,
  GatewayObservationData,
  GatewayProcessIdentityConsistency,
  GatewayProcessMode,
  GatewayProcessState,
  GatewayServiceDefinitionState,
  GatewayServiceState,
} from "../../domain/gateway/gateway-observation.js";
