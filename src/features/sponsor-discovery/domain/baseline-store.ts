export interface BaselineAffinityStore {
  get(entityId: string): Promise<number | undefined>;
  set(entityId: string, affinity: number): Promise<void>;
}
