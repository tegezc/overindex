import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type QlooLaunch = {
  command: string;
  argsPrefix: string[];
};

let cached: QlooLaunch | undefined;

/**
 * `execFile` has no shell, so a Windows `qloo.cmd` shim cannot be the command.
 * Resolve the package's JS entry and run it with the current Node binary.
 * Non-Windows keeps `command: "qloo"`.
 */
export function resolveQlooLaunch(): QlooLaunch {
  if (cached) return cached;
  if (process.platform !== "win32") {
    cached = { command: "qloo", argsPrefix: [] };
    return cached;
  }
  const script = findWindowsScript();
  cached = { command: process.execPath, argsPrefix: [script] };
  return cached;
}

export function qlooArgs(launch: QlooLaunch, args: string[]): string[] {
  return [...launch.argsPrefix, ...args];
}

function findWindowsScript(): string {
  let listed = "";
  try {
    listed = execFileSync("where.exe", ["qloo"], { encoding: "utf8", windowsHide: true });
  } catch {
    throw new Error("QLOO_NOT_INSTALLED");
  }
  const candidates = listed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    const fromPackage = scriptFromPackage(candidate);
    if (fromPackage) return fromPackage;
    const fromShim = scriptFromShim(candidate);
    if (fromShim) return fromShim;
  }
  throw new Error("QLOO_NOT_INSTALLED");
}

function scriptFromPackage(commandPath: string): string | undefined {
  const root = path.join(path.dirname(commandPath), "node_modules", "@qloo", "qloo-harness");
  const pkgPath = path.join(root, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  let bin: string | undefined;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin?: string | Record<string, string> };
    bin = typeof pkg.bin === "string" ? pkg.bin : (pkg.bin?.qloo ?? Object.values(pkg.bin ?? {})[0]);
  } catch {
    return undefined;
  }
  if (!bin) return undefined;
  const script = path.resolve(root, bin);
  return existsSync(script) ? script : undefined;
}

function scriptFromShim(commandPath: string): string | undefined {
  if (!existsSync(commandPath) || !commandPath.toLowerCase().endsWith(".cmd")) return undefined;
  const text = readFileSync(commandPath, "utf8");
  const dir = path.dirname(commandPath);
  for (const match of text.matchAll(/"([^"]+\.(?:js|mjs|cjs))"/gi)) {
    const expanded = match[1].replace(/%~dp0\\?/gi, `${dir}${path.sep}`).replace(/%dp0%\\?/gi, `${dir}${path.sep}`);
    if (existsSync(expanded)) return expanded;
  }
  return undefined;
}
