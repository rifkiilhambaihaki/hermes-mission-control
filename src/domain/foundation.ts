export type FoundationState = "OPERATIONAL_READ_ONLY";

export interface FoundationDescriptor {
  readonly product: "Hermes Mission Control";
  readonly state: FoundationState;
  readonly readOnly: true;
}

export const foundationDescriptor: FoundationDescriptor = Object.freeze({
  product: "Hermes Mission Control",
  state: "OPERATIONAL_READ_ONLY",
  readOnly: true,
});
