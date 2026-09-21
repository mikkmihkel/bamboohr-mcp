import * as path from "node:path";
import { resolveAppPaths, type AppPaths } from "./appPaths";
import { createCredentialStore, type CredentialStore } from "./credentialStore";
import { readSettings, SUBDOMAIN_RE, type Settings } from "./settings";

export interface Config {
  token: string;
  companyDomain: string;
  vacationType?: string;
  settings: Settings;
  paths: AppPaths;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** No API key in the OS credential store. The server still starts; every tool call reports this. */
export class NotEnrolledError extends ConfigError {
  constructor(message: string) {
    super(message);
    this.name = "NotEnrolledError";
  }
}

/**
 * The exact command the user has to run to enrol. `__dirname` resolves to the
 * installed location (dist/, or the unpacked .mcpb directory), so the hint
 * works no matter where Claude Desktop put the bundle.
 */
export function enrolmentCommand(platform: NodeJS.Platform = process.platform): string {
  const entryPoint = path.join(__dirname, "index.js");
  // PowerShell parses a line that starts with a quoted path as a string
  // expression, so the call operator is needed for the command to run.
  const call = platform === "win32" ? "& " : "";
  return `${call}"${process.execPath}" "${entryPoint}" enroll`;
}

export interface LoadConfigDeps {
  env?: NodeJS.ProcessEnv;
  paths?: AppPaths;
  store?: CredentialStore;
}

/**
 * Resolve the runtime configuration: non-secret settings from config.json plus
 * environment overrides, and the API key from the OS credential store only.
 * There is deliberately no environment variable for the key.
 */
export async function loadConfig(deps: LoadConfigDeps = {}): Promise<Config> {
  const env = deps.env ?? process.env;
  const paths = deps.paths ?? resolveAppPaths(env);
  const settings = readSettings(paths, env);
  const store = deps.store ?? createCredentialStore(paths);

  const token = (await store.get())?.trim();
  if (!token) {
    throw new NotEnrolledError(
      `No BambooHR API key is enrolled on this machine. Run: ${enrolmentCommand()}` +
        "  — the key is stored in the OS credential store and is never written to config files."
    );
  }

  const companyDomain = settings.companyDomain;
  if (!companyDomain) {
    throw new ConfigError(
      `No BambooHR company subdomain is configured in ${paths.configFile}. Run: ${enrolmentCommand()}`
    );
  }
  if (!SUBDOMAIN_RE.test(companyDomain)) {
    throw new ConfigError(
      `companyDomain must be the bare subdomain (e.g. "acme" for acme.bamboohr.com), got "${companyDomain}"`
    );
  }

  const config: Config = { token, companyDomain, settings, paths };
  if (settings.vacationType) config.vacationType = settings.vacationType;
  return config;
}
