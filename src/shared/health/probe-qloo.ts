export type QlooProbe = "ready" | "missing";

export async function probeQloo(deps: {
  assertBaseUrl: () => Promise<void>;
  capabilities: () => Promise<QlooProbe>;
}): Promise<QlooProbe> {
  try {
    await deps.assertBaseUrl();
    return await deps.capabilities();
  } catch {
    return "missing";
  }
}
