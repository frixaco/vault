import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { arch, platform } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const desktopDir = join(repoRoot, "desktop");
const appName = "Vault";
const defaultMetricsPath = join(repoRoot, "metrics", "desktop-memory-runs.jsonl");
const defaultBuiltAppPath = join(desktopDir, "dist", "mac-arm64", `${appName}.app`);

type Options = {
  installPath: string;
  keepRunning: boolean;
  keychainProfile: string;
  metricsPath: string;
  sampleIntervalMs: number;
  samples: number;
  skipBuild: boolean;
  skipInstall: boolean;
  unsigned: boolean;
  waitMs: number;
};

type ProcessRow = {
  args: string;
  command: string;
  pid: number;
  ppid: number;
  rssKb: number;
};

type MemorySample = {
  processCount: number;
  rssMb: number;
  timestamp: string;
};

type MetricRecord = {
  appSizeMb: number;
  arch: string;
  buildMode: "signed" | "unsigned";
  dmgSizeMb: number | null;
  electronVersion: string | null;
  gitBranch: string | null;
  gitCommit: string | null;
  gitDirty: boolean | null;
  installPath: string;
  macOS: string | null;
  nodeVersion: string;
  peakRssMb: number;
  processCount: number;
  rssMb: number;
  samples: MemorySample[];
  timestamp: string;
  version: string;
  zipSizeMb: number | null;
};

function parseOptions(argv: string[]): Options {
  const options: Options = {
    installPath: "/Applications/Vault.app",
    keepRunning: false,
    keychainProfile: process.env.APPLE_KEYCHAIN_PROFILE ?? "vault-notary",
    metricsPath: defaultMetricsPath,
    sampleIntervalMs: 1000,
    samples: 5,
    skipBuild: false,
    skipInstall: false,
    unsigned: false,
    waitMs: 20000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--keep-running") {
      options.keepRunning = true;
      continue;
    }

    if (arg === "--skip-build") {
      options.skipBuild = true;
      continue;
    }

    if (arg === "--skip-install") {
      options.skipInstall = true;
      continue;
    }

    if (arg === "--unsigned") {
      options.unsigned = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--install-path") {
      options.installPath = resolvePath(value);
      index += 1;
      continue;
    }

    if (arg === "--keychain-profile") {
      options.keychainProfile = value;
      index += 1;
      continue;
    }

    if (arg === "--metrics-path") {
      options.metricsPath = resolvePath(value);
      index += 1;
      continue;
    }

    if (arg === "--sample-interval-ms") {
      options.sampleIntervalMs = parsePositiveInteger(arg, value);
      index += 1;
      continue;
    }

    if (arg === "--samples") {
      options.samples = parsePositiveInteger(arg, value);
      index += 1;
      continue;
    }

    if (arg === "--wait-ms") {
      options.waitMs = parsePositiveInteger(arg, value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function resolvePath(value: string): string {
  return isAbsolute(value) ? value : resolve(repoRoot, value);
}

function parsePositiveInteger(flag: string, value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function printHelp(): void {
  console.log(`Usage: pnpm measure-desktop-mac [options]

Build, install, launch, measure, and record macOS desktop release memory.

Options:
  --unsigned                 Build an unsigned local-only release artifact
  --keychain-profile <name>  Notary keychain profile, default: APPLE_KEYCHAIN_PROFILE or vault-notary
  --skip-build               Use the existing desktop/dist/mac-arm64/Vault.app
  --skip-install             Launch the existing app at --install-path
  --install-path <path>      Installed app path, default: /Applications/Vault.app
  --metrics-path <path>      JSONL metrics path, default: metrics/desktop-memory-runs.jsonl
  --wait-ms <number>         Wait after launch before sampling, default: 20000
  --samples <number>         Number of memory samples, default: 5
  --sample-interval-ms <n>   Delay between samples, default: 1000
  --keep-running             Leave the app open after measuring
`);
}

async function main(): Promise<void> {
  if (platform() !== "darwin") {
    throw new Error("desktop release memory measurement currently supports macOS only");
  }

  const options = parseOptions(process.argv.slice(2));
  const desktopPackage = await readJson<{
    version: string;
    devDependencies?: Record<string, string>;
  }>(join(desktopDir, "package.json"));

  if (!options.skipBuild) {
    await buildRelease(options);
  }

  if (!options.skipInstall && !existsSync(defaultBuiltAppPath)) {
    throw new Error(`Built app not found at ${defaultBuiltAppPath}`);
  }

  await quitApp();

  const appPath = options.skipInstall ? options.installPath : await installApp(options.installPath);

  await launchApp(appPath);
  console.log(`[desktop-memory] Waiting ${options.waitMs}ms before sampling...`);
  await sleep(options.waitMs);

  const mainPid = await waitForMainPid(appPath, 15000);
  const samples = await sampleMemory(mainPid, options.samples, options.sampleIntervalMs);
  const rssMb = roundMb(average(samples.map((sample) => sample.rssMb)));
  const peakRssMb = Math.max(...samples.map((sample) => sample.rssMb));
  const latestSample = samples.at(-1);

  if (!latestSample) {
    throw new Error("No memory samples were collected");
  }

  const record: MetricRecord = {
    appSizeMb: await pathSizeMb(appPath),
    arch: arch(),
    buildMode: options.unsigned ? "unsigned" : "signed",
    dmgSizeMb: await artifactSizeMb("dmg"),
    electronVersion: desktopPackage.devDependencies?.electron ?? null,
    gitBranch: await commandOrNull("git", ["branch", "--show-current"]),
    gitCommit: await commandOrNull("git", ["rev-parse", "--short", "HEAD"]),
    gitDirty: await gitDirtyOrNull(),
    installPath: appPath,
    macOS: await commandOrNull("sw_vers", ["-productVersion"]),
    nodeVersion: process.version,
    peakRssMb,
    processCount: latestSample.processCount,
    rssMb,
    samples,
    timestamp: new Date().toISOString(),
    version: desktopPackage.version,
    zipSizeMb: await artifactSizeMb("zip"),
  };

  const previous = await readPreviousRecord(options.metricsPath);
  await appendMetric(options.metricsPath, record);
  printSummary(record, previous, options.metricsPath);

  if (!options.keepRunning) {
    await quitApp();
  }
}

async function buildRelease(options: Options): Promise<void> {
  const env = { ...process.env };

  if (options.unsigned) {
    env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
    delete env.APPLE_KEYCHAIN_PROFILE;
  } else {
    env.APPLE_KEYCHAIN_PROFILE = options.keychainProfile;
    delete env.CSC_IDENTITY_AUTO_DISCOVERY;
  }

  console.log(
    `[desktop-memory] Building ${options.unsigned ? "unsigned" : "signed"} macOS arm64 release...`,
  );
  await run("pnpm", ["dist-desktop-mac-arm64"], { cwd: repoRoot, env });
}

async function installApp(installPath: string): Promise<string> {
  console.log(`[desktop-memory] Installing ${defaultBuiltAppPath} -> ${installPath}`);
  await rm(installPath, { force: true, recursive: true });
  await mkdir(dirname(installPath), { recursive: true });
  await run("/usr/bin/ditto", [defaultBuiltAppPath, installPath], { cwd: repoRoot });
  return installPath;
}

async function launchApp(appPath: string): Promise<void> {
  console.log(`[desktop-memory] Launching ${appPath}`);
  await execFileText("open", ["-n", appPath], { cwd: repoRoot });
}

async function quitApp(): Promise<void> {
  await execFileText("osascript", ["-e", `tell application "${appName}" to quit`], {
    cwd: repoRoot,
  }).catch(() => undefined);
  await sleep(1500);
}

async function waitForMainPid(appPath: string, timeoutMs: number): Promise<number> {
  const start = Date.now();
  const executablePath = `${appPath}/Contents/MacOS/${appName}`;

  while (Date.now() - start < timeoutMs) {
    const rows = await listProcesses();
    const mainProcess = rows.find(
      (row) => row.args.includes(executablePath) || row.command === executablePath,
    );

    if (mainProcess) {
      return mainProcess.pid;
    }

    await sleep(500);
  }

  throw new Error(`Could not find running ${appName} process for ${appPath}`);
}

async function sampleMemory(
  mainPid: number,
  sampleCount: number,
  sampleIntervalMs: number,
): Promise<MemorySample[]> {
  const samples: MemorySample[] = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const rows = await listProcesses();
    const tree = collectProcessTree(rows, mainPid);
    const rssKb = tree.reduce((sum, row) => sum + row.rssKb, 0);

    samples.push({
      processCount: tree.length,
      rssMb: roundMb(rssKb / 1024),
      timestamp: new Date().toISOString(),
    });

    if (index < sampleCount - 1) {
      await sleep(sampleIntervalMs);
    }
  }

  return samples;
}

function collectProcessTree(rows: ProcessRow[], rootPid: number): ProcessRow[] {
  const byParent = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    const children = byParent.get(row.ppid) ?? [];
    children.push(row);
    byParent.set(row.ppid, children);
  }

  const collected: ProcessRow[] = [];
  const queue = [rootPid];
  const seen = new Set<number>();

  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid === undefined || seen.has(pid)) continue;
    seen.add(pid);

    const row = rows.find((candidate) => candidate.pid === pid);
    if (row) {
      collected.push(row);
    }

    const children = byParent.get(pid) ?? [];
    for (const child of children) {
      queue.push(child.pid);
    }
  }

  return collected;
}

async function listProcesses(): Promise<ProcessRow[]> {
  const output = await execFileText("ps", ["-axo", "pid=,ppid=,rss=,comm=,args="], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 10,
  });

  return output
    .split("\n")
    .map((line) => parseProcessRow(line))
    .filter((row): row is ProcessRow => row !== null);
}

function parseProcessRow(line: string): ProcessRow | null {
  const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
  if (!match) return null;

  const [, pid, ppid, rssKb, command, args] = match;
  if (!pid || !ppid || !rssKb || !command || args === undefined) return null;

  return {
    args,
    command,
    pid: Number.parseInt(pid, 10),
    ppid: Number.parseInt(ppid, 10),
    rssKb: Number.parseInt(rssKb, 10),
  };
}

async function artifactSizeMb(extension: "dmg" | "zip"): Promise<number | null> {
  const distEntries = await readdir(join(desktopDir, "dist")).catch(() => []);
  const artifact = distEntries
    .filter((entry) => entry.endsWith(`-arm64.${extension}`))
    .sort()
    .at(-1);

  if (!artifact) {
    return null;
  }

  const artifactStat = await stat(join(desktopDir, "dist", artifact));
  return roundMb(artifactStat.size / 1024 / 1024);
}

async function pathSizeMb(path: string): Promise<number> {
  const output = await execFileText("du", ["-sk", path], { cwd: repoRoot });
  const sizeKb = Number.parseInt(output.split(/\s+/)[0] ?? "", 10);
  if (!Number.isFinite(sizeKb)) {
    throw new Error(`Could not read size for ${path}`);
  }
  return roundMb(sizeKb / 1024);
}

async function readPreviousRecord(metricsPath: string): Promise<MetricRecord | null> {
  const content = await readFile(metricsPath, "utf8").catch(() => "");
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines.reverse()) {
    try {
      return JSON.parse(line) as MetricRecord;
    } catch {
      continue;
    }
  }

  return null;
}

async function appendMetric(metricsPath: string, record: MetricRecord): Promise<void> {
  await mkdir(dirname(metricsPath), { recursive: true });
  await appendFile(metricsPath, `${JSON.stringify(record)}\n`, "utf8");
}

function printSummary(
  record: MetricRecord,
  previous: MetricRecord | null,
  metricsPath: string,
): void {
  console.log("\nDesktop release memory");
  console.log(`  RSS average: ${record.rssMb} MB`);
  console.log(`  RSS peak:    ${record.peakRssMb} MB`);
  console.log(`  Processes:   ${record.processCount}`);
  console.log(`  App size:    ${record.appSizeMb} MB`);

  if (previous) {
    const rssDelta = roundMb(record.rssMb - previous.rssMb);
    const appDelta = roundMb(record.appSizeMb - previous.appSizeMb);
    console.log("\nCompared to previous run");
    console.log(`  RSS average: ${formatDelta(rssDelta)} MB`);
    console.log(`  App size:    ${formatDelta(appDelta)} MB`);
    console.log(`  Previous:    ${previous.timestamp} (${previous.gitCommit ?? "unknown commit"})`);
  } else {
    console.log("\nCompared to previous run");
    console.log("  No previous run recorded.");
  }

  console.log(`\nRecorded: ${metricsPath}`);
}

function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundMb(value: number): number {
  return Math.round(value * 100) / 100;
}

async function gitDirtyOrNull(): Promise<boolean | null> {
  const output = await commandOrNull("git", ["status", "--porcelain"]);
  return output === null ? null : output.length > 0;
}

async function commandOrNull(command: string, args: string[]): Promise<string | null> {
  return execFileText(command, args, { cwd: repoRoot }).catch(() => null);
}

async function execFileText(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    maxBuffer?: number;
  },
): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env,
    maxBuffer: options.maxBuffer,
  });
  return stdout.trim();
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function run(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}`));
    });
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
