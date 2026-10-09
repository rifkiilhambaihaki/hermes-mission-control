export type GatewayProcessState = "RUNNING" | "STOPPED" | "UNKNOWN";
export type GatewayProcessIdentityConsistency =
  | "CONSISTENT"
  | "INCONSISTENT"
  | "NOT_APPLICABLE"
  | "UNKNOWN";
export type GatewayProcessMode = "MANAGED" | "MANUAL" | "UNKNOWN";
export type GatewayServiceState = "ACTIVE" | "INACTIVE" | "UNAVAILABLE" | "UNKNOWN";
export type GatewayManagerCategory = "USER_SERVICE" | "SYSTEM_SERVICE" | "MANUAL" | "NONE" | "UNKNOWN";
export type GatewayDuplicateDefinitionState = "DETECTED" | "NOT_DETECTED" | "UNKNOWN";
export type GatewayServiceDefinitionState =
  | "CURRENT"
  | "REVIEW_REQUIRED"
  | "OUTDATED"
  | "UNKNOWN";

export interface GatewayObservationData {
  readonly processState: GatewayProcessState;
  readonly processIdentityConsistency: GatewayProcessIdentityConsistency;
  readonly processMode: GatewayProcessMode;
  readonly userServiceState: GatewayServiceState;
  readonly systemServiceState: GatewayServiceState;
  readonly managerCategory: GatewayManagerCategory;
  readonly duplicateDefinitionState: GatewayDuplicateDefinitionState;
  readonly serviceDefinitionState: GatewayServiceDefinitionState;
}
