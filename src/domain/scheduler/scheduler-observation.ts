export type SchedulerAvailability = "AVAILABLE" | "EMPTY";

export interface SchedulerData {
  readonly schedulerAvailability: SchedulerAvailability;
  readonly enabledJobCount: number;
  readonly totalJobCount: number;
}
