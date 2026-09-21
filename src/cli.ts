import * as readline from "node:readline";
import { resolveAppPaths, type AppPaths } from "./appPaths";
import { createCredentialStore, CredentialStoreError, type CredentialStore } from "./credentialStore";
import { runSelfCheck } from "./selfCheck";
import {
  DEFAULT_REVOCATION_URL,
  readSettings as readSettingsImpl,
  SUBDOMAIN_RE,
  writeSettings as writeSettingsImpl,
  type Settings,
} from "./settings";
import { VERSION } from "./version";

export const SUBCOMMANDS = ["enroll", "unenroll", "status", "logs", "doctor", "version", "--version", "-v"] as const;

/** True when argv[0] names a subcommand; index.ts starts the MCP server otherwise. */
export function isSubcommand(arg: string | undefined): boolean {
  return arg !== undefined && (SUBCOMMANDS as readonly string[]).includes(arg);
}

export interface CliDeps {
  paths: AppPaths;
  store: CredentialStore;
  readSettings: (paths: AppPaths, env?: NodeJS.ProcessEnv) => Settings;
  writeSettings: (paths: AppPaths, patch: Partial<Settings>) => void;
  /** Injected so the CLI tests do not need the audit module or a log on disk. */
  readRecentEntries: (logDir: string, limit: number) => unknown[];
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  prompt: (question: string, options?: { secret?: boolean }) => Promise<string>;
  readStdin: () => Promise<string>;
  fetch: typeof fetch;
  env: NodeJS.ProcessEnv;
  version: string;
}

const DEFAULT_TAIL = 50;

const EXIT_OK = 0;
const EXIT_PROBLEM = 2;
const EXIT_REVOKED = 3;

/**
 * Ask on the terminal. With `secret: true` the readline echo is suppressed, so
 * the API key never reaches the screen or the terminal scrollback.
 */
async function defaultPrompt(question: string, options: { secret?: boolean } = {}): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    if (!options.secret) {
      return await new Promise<string>((resolve) => rl.question(question, resolve));
    }
    // Swallow everything readline would echo, then write the prompt ourselves.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    const answer = new Promise<string>((resolve) => rl.question(question, resolve));
    process.stdout.write(question);
    const value = await answer;
    process.stdout.write("\n");
    return value;
  } finally {
    rl.close();
  }
}

async function defaultReadStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * `readRecentEntries` is loaded on demand: `logs` is the only subcommand that
 * needs the audit module, and the tests inject their own reader.
 */
function defaultReadRecentEntries(logDir: string, limit: number): unknown[] {
  const audit = require("./audit") as typeof import("./audit");
  return audit.readRecentEntries(logDir, limit);
}

function resolveDeps(overrides: Partial<CliDeps>): CliDeps {
  const env = overrides.env ?? process.env;
  const paths = overrides.paths ?? resolveAppPaths(env);
  return {
    env,
    paths,
    store: overrides.store ?? createCredentialStore(paths),
    readSettings: overrides.readSettings ?? readSettingsImpl,
    writeSettings: overrides.writeSettings ?? writeSettingsImpl,
    readRecentEntries: overrides.readRecentEntries ?? defaultReadRecentEntries,
    stdout: overrides.stdout ?? ((line) => process.stdout.write(`${line}\n`)),
    stderr: overrides.stderr ?? ((line) => process.stderr.write(`${line}\n`)),
    prompt: overrides.prompt ?? defaultPrompt,
    readStdin: overrides.readStdin ?? defaultReadStdin,
    fetch: overrides.fetch ?? fetch,
    version: overrides.version ?? VERSION,
  };
}

class UsageError extends Error {}

interface ParsedFlags {
  values: Record<string, string>;
  booleans: Record<string, boolean>;
}

/** Minimal flag parser: `--flag value` for the listed keys, `--flag` for the listed switches. */
function parseFlags(args: string[], withValue: string[], switches: string[]): ParsedFlags {
  const values: Record<string, string> = {};
  const booleans: Record<string, boolean> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (withValue.includes(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${arg} needs a value`);
      values[arg] = value;
      i += 1;
    } else if (switches.includes(arg)) {
      booleans[arg] = true;
    } else {
      throw new UsageError(`unknown option "${arg}"`);
    }
  }
  return { values, booleans };
}

function settingsLines(settings: Settings): string[] {
  return [
    `company domain:    ${settings.companyDomain ?? "(not set)"}`,
    `vacation type:     ${settings.vacationType ?? "(auto-detected)"}`,
    `sensitive tools:   ${settings.enableSensitiveTools ? "enabled" : "disabled"}`,
    `max records:       ${settings.maxRecords}`,
    `revocation url:    ${settings.revocationUrl ?? DEFAULT_REVOCATION_URL}`,
    `strict self-check: ${settings.strictSelfCheck ? "on" : "off"}`,
  ];
}

/** Read the key without echoing it, or from stdin for scripted enrolment. */
async function collectKey(args: ParsedFlags, deps: CliDeps): Promise<string> {
  const raw = args.booleans["--key-stdin"]
    ? await deps.readStdin()
    : await deps.prompt("BambooHR API key (input hidden): ", { secret: true });
  return raw.trim();
}

async function enroll(argv: string[], deps: CliDeps): Promise<number> {
  const flags = parseFlags(
    argv,
    ["--subdomain", "--vacation-type", "--max-records", "--revocation-url"],
    ["--enable-sensitive-tools", "--disable-sensitive-tools", "--strict-self-check", "--no-strict-self-check", "--key-stdin"]
  );

  const subdomain = (flags.values["--subdomain"] ?? (await deps.prompt("BambooHR subdomain (e.g. \"acme\" for acme.bamboohr.com): "))).trim();
  if (!subdomain) {
    deps.stderr("enroll: a subdomain is required.");
    return EXIT_PROBLEM;
  }
  if (!SUBDOMAIN_RE.test(subdomain)) {
    deps.stderr(`enroll: "${subdomain}" is not a bare subdomain — use "acme" for acme.bamboohr.com.`);
    return EXIT_PROBLEM;
  }

  const key = await collectKey(flags, deps);
  if (!key) {
    deps.stderr("enroll: the API key must not be empty. Nothing was stored.");
    return EXIT_PROBLEM;
  }

  const patch: Partial<Settings> = { companyDomain: subdomain };
  if (flags.values["--vacation-type"]) patch.vacationType = flags.values["--vacation-type"];
  if (flags.values["--max-records"] !== undefined) {
    const n = Number(flags.values["--max-records"]);
    if (!Number.isInteger(n)) throw new UsageError("--max-records needs a whole number");
    patch.maxRecords = n;
  }
  if (flags.booleans["--enable-sensitive-tools"] && flags.booleans["--disable-sensitive-tools"]) {
    throw new UsageError("--enable-sensitive-tools and --disable-sensitive-tools are mutually exclusive");
  }
  if (flags.booleans["--enable-sensitive-tools"]) patch.enableSensitiveTools = true;
  if (flags.booleans["--disable-sensitive-tools"]) patch.enableSensitiveTools = false;
  if (flags.values["--revocation-url"]) patch.revocationUrl = flags.values["--revocation-url"];
  if (flags.booleans["--strict-self-check"] && flags.booleans["--no-strict-self-check"]) {
    throw new UsageError("--strict-self-check and --no-strict-self-check are mutually exclusive");
  }
  if (flags.booleans["--strict-self-check"]) patch.strictSelfCheck = true;
  if (flags.booleans["--no-strict-self-check"]) patch.strictSelfCheck = false;

  await deps.store.set(key);
  deps.writeSettings(deps.paths, patch);

  deps.stdout(`Stored the API key in the OS credential store (backend: ${deps.store.backend}).`);
  deps.stdout("The key is never written to config.json, the environment or any log.");
  deps.stdout(`Settings written to ${deps.paths.configFile}`);
  deps.stdout(`Audit log directory: ${deps.paths.logDir}`);
  for (const line of settingsLines(deps.readSettings(deps.paths, {}))) deps.stdout(line);
  return EXIT_OK;
}

async function unenroll(argv: string[], deps: CliDeps): Promise<number> {
  parseFlags(argv, [], []);
  await deps.store.delete();
  deps.stdout(`Removed the API key from the OS credential store (backend: ${deps.store.backend}).`);
  deps.stdout(`Settings in ${deps.paths.configFile} were kept.`);
  return EXIT_OK;
}

/** Whether a key is enrolled — never what it is. */
async function isEnrolled(deps: CliDeps): Promise<{ enrolled: boolean; problem?: string }> {
  try {
    return { enrolled: (await deps.store.get()) !== undefined };
  } catch (e) {
    const hint = e instanceof CredentialStoreError ? ` ${e.hint}` : "";
    return { enrolled: false, problem: `${(e as Error).message}.${hint}` };
  }
}

async function status(argv: string[], deps: CliDeps): Promise<number> {
  parseFlags(argv, [], []);
  const settings = deps.readSettings(deps.paths, deps.env);
  const { enrolled, problem } = await isEnrolled(deps);

  deps.stdout(`bamboohr-mcp ${deps.version}`);
  deps.stdout(`credential store:  ${deps.store.backend}`);
  deps.stdout(`API key enrolled:  ${enrolled ? "yes" : "no"}`);
  deps.stdout(`config file:       ${deps.paths.configFile}`);
  deps.stdout(`log directory:     ${deps.paths.logDir}`);
  for (const line of settingsLines(settings)) deps.stdout(line);
  if (problem) deps.stderr(`credential store problem: ${problem}`);
  if (!enrolled) deps.stderr(`Not enrolled. Run the enroll subcommand to store an API key.`);
  return enrolled ? EXIT_OK : EXIT_PROBLEM;
}

function logs(argv: string[], deps: CliDeps): number {
  const flags = parseFlags(argv, ["--tail"], []);
  let tail = DEFAULT_TAIL;
  if (flags.values["--tail"] !== undefined) {
    const n = Number(flags.values["--tail"]);
    if (!Number.isInteger(n) || n <= 0) throw new UsageError("--tail needs a positive whole number");
    tail = n;
  }
  deps.stdout(`Audit log directory: ${deps.paths.logDir}`);
  for (const entry of deps.readRecentEntries(deps.paths.logDir, tail)) {
    deps.stdout(JSON.stringify(entry));
  }
  return EXIT_OK;
}

async function doctor(argv: string[], deps: CliDeps): Promise<number> {
  parseFlags(argv, [], []);
  const settings = deps.readSettings(deps.paths, deps.env);
  let exit = EXIT_OK;

  deps.stdout(`bamboohr-mcp ${deps.version} doctor`);
  deps.stdout(`config file:  ${deps.paths.configFile}`);
  deps.stdout(`log directory: ${deps.paths.logDir}`);

  if (settings.companyDomain) {
    deps.stdout(`[ok]   company subdomain: ${settings.companyDomain}`);
  } else {
    deps.stdout("[fail] no company subdomain configured — run the enroll subcommand");
    exit = EXIT_PROBLEM;
  }

  const { enrolled, problem } = await isEnrolled(deps);
  if (enrolled) {
    deps.stdout(`[ok]   API key enrolled in ${deps.store.backend}`);
  } else {
    deps.stdout(`[fail] no API key in ${deps.store.backend}${problem ? `: ${problem}` : " — run the enroll subcommand"}`);
    exit = EXIT_PROBLEM;
  }

  // No BambooHR call is made: doctor must be safe to run without credentials.
  const url = settings.revocationUrl ?? DEFAULT_REVOCATION_URL;
  let result;
  try {
    result = await runSelfCheck(url, deps.version, deps.fetch);
  } catch (e) {
    result = { status: "unavailable" as const, reason: (e as Error).message };
  }
  if (result.status === "ok") {
    deps.stdout(`[ok]   self-check: ${deps.version} is not revoked`);
  } else if (result.status === "revoked") {
    deps.stdout(`[fail] self-check: ${result.reason}`);
    exit = EXIT_REVOKED;
  } else if (settings.strictSelfCheck) {
    deps.stdout(`[fail] self-check: ${result.reason} (strictSelfCheck is on, the server would refuse to start)`);
    if (exit === EXIT_OK) exit = EXIT_PROBLEM;
  } else {
    deps.stdout(`[warn] self-check: ${result.reason} (strictSelfCheck is off, the server would still start)`);
  }
  return exit;
}

const USAGE = [
  "bamboohr-mcp — read-only MCP server for BambooHR",
  "",
  "Usage:",
  "  bamboohr-mcp                    start the stdio MCP server (no subcommand)",
  "  bamboohr-mcp enroll [options]   store the API key in the OS credential store",
  "  bamboohr-mcp unenroll           delete the API key (settings are kept)",
  "  bamboohr-mcp status             show backend, enrolment, paths and settings",
  "  bamboohr-mcp logs [--tail N]    print the last N audit entries (default 50)",
  "  bamboohr-mcp doctor             check enrolment and version revocation",
  "  bamboohr-mcp --version          print the version",
  "",
  "enroll options:",
  "  --subdomain <name>              BambooHR subdomain, prompted for when omitted",
  "  --vacation-type <name>          time-off type that counts as vacation",
  "  --max-records <n>               per-call record cap (1..500)",
  "  --enable-sensitive-tools | --disable-sensitive-tools",
  "  --revocation-url <https url>    self-check document URL",
  "  --strict-self-check | --no-strict-self-check",
  "  --key-stdin                     read the API key from stdin instead of prompting;",
  "                                  this is the only non-interactive way to enrol —",
  "                                  the key is never accepted as a command line argument.",
].join("\n");

/**
 * Run one subcommand and return the process exit code. Every dependency is
 * injectable so the whole CLI is testable without a credential store, a
 * terminal or the network.
 */
export async function runCli(argv: string[], overrides: Partial<CliDeps> = {}): Promise<number> {
  const deps = resolveDeps(overrides);
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "enroll":
        return await enroll(rest, deps);
      case "unenroll":
        return await unenroll(rest, deps);
      case "status":
        return await status(rest, deps);
      case "logs":
        return logs(rest, deps);
      case "doctor":
        return await doctor(rest, deps);
      case "version":
      case "--version":
      case "-v":
        deps.stdout(deps.version);
        return EXIT_OK;
      default:
        deps.stderr(USAGE);
        return EXIT_PROBLEM;
    }
  } catch (e) {
    if (e instanceof UsageError) {
      deps.stderr(`bamboohr-mcp ${command}: ${e.message}`);
      deps.stderr(USAGE);
      return EXIT_PROBLEM;
    }
    if (e instanceof CredentialStoreError) {
      deps.stderr(`bamboohr-mcp ${command}: ${e.message}`);
      deps.stderr(`hint: ${e.hint}`);
      return EXIT_PROBLEM;
    }
    deps.stderr(`bamboohr-mcp ${command}: ${(e as Error).message}`);
    return EXIT_PROBLEM;
  }
}
