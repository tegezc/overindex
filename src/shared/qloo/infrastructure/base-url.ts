import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { qlooArgs, resolveQlooLaunch } from "./qloo-launch";

const execFileAsync = promisify(execFile);

export const HACKATHON_BASE_URL = "https://hackathon.api.qloo.com";

export class BaseUrlError extends Error {
  readonly code = "BASE_URL";
  readonly retryable = false;

  constructor() {
    super("BASE_URL");
    this.name = "BaseUrlError";
  }
}

let checked: Promise<void> | undefined;

export function isHackathonBaseUrlOutput(text: string): boolean {
  const urls = [...text.matchAll(/https:\/\/[^\s"'<>]+/gi)].map((match) =>
    match[0].replace(/\/+$/, "").replace(/[),.;]+$/, "").toLowerCase(),
  );
  const qlooHosts = urls.filter((url) => url.includes("api.qloo.com"));
  return qlooHosts.length > 0 && qlooHosts.every((url) => url === HACKATHON_BASE_URL);
}

/** Local `qloo api config get`. Does not call the Qloo API and does not log the value. */
export function assertHackathonBaseUrl(): Promise<void> {
  checked ??= verify().catch((error) => {
    checked = undefined;
    throw error;
  });
  return checked;
}

async function verify(): Promise<void> {
  const launch = resolveQlooLaunch();
  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync(launch.command, qlooArgs(launch, ["api", "config", "get", "base-url"]), {
      encoding: "utf8",
      timeout: 20_000,
      windowsHide: true,
    });
    stdout = result.stdout;
    stderr = String(result.stderr ?? "");
  } catch {
    throw new BaseUrlError();
  }
  if (!isHackathonBaseUrlOutput(`${stdout}\n${stderr}`)) throw new BaseUrlError();
}
