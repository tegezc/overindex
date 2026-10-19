export interface QlooCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}
