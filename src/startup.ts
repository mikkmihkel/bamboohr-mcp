import type { AppPaths } from "./appPaths";
import { createBambooHRApi, type BambooHRApi } from "./bamboohr";
import { createClient } from "./client";
import { ConfigError, DESKTOP_SETTINGS_HINT, enrolmentCommand, loadConfig, type Config } from "./config";
import { CredentialStoreError } from "./credentialStore";
import { notEnrolledApi } from "./notEnrolledApi";
import { runSelfCheck, type SelfCheckResult } from "./selfCheck";
import { DEFAULT_REVOCATION_URL, type Settings } from "./settings";

export interface StartupDeps {
  selfCheck?: (url: string, version: string) => Promise<SelfCheckResult>;
  loadConfig?: (options: { paths: AppPaths }) => Promise<Config>;
  createApi?: (config: Config) => BambooHRApi;
}

export interface Startup {
  api: BambooHRApi;
  /** One line for stderr describing how the server came up. */
  banner: string;
  warnings: string[];
}

const RELEASES_URL = "https://github.com/mikkmihkel/bamboohr-mcp/releases/latest";

function refusing(reason: string, name: string): Startup {
  const error = new Error(reason);
  error.name = name; // the audit log records the class name only
  return { api: notEnrolledApi(error), banner: `serving no data — ${reason}`, warnings: [] };
}

/**
 * Everything that can be slow or can fail at start-up: the version self-check (a
 * network request) and the key lookup (an OS credential-store helper, which can sit
 * behind an unlock prompt). It runs after the MCP transport is connected, so Claude
 * Desktop's initialize never waits on it. It never rejects: every failure becomes a
 * stand-in API that answers each tool call with the reason, so the user sees why in
 * the chat instead of a connector that failed to start.
 */
export async function resolveApi(
  paths: AppPaths,
  settings: Settings,
  version: string,
  deps: StartupDeps = {}
): Promise<Startup> {
  const selfCheck = deps.selfCheck ?? ((url: string, v: string) => runSelfCheck(url, v));
  let check: SelfCheckResult;
  try {
    check = await selfCheck(settings.revocationUrl ?? DEFAULT_REVOCATION_URL, version);
  } catch (e) {
    check = { status: "unavailable", reason: (e as Error).message };
  }
  const warnings: string[] = [];
  if (check.status === "revoked") {
    return refusing(`This version (${version}) has been revoked: ${check.reason} Install the latest release: ${RELEASES_URL}`, "RevokedVersionError");
  }
  if (check.status === "unavailable") {
    if (settings.strictSelfCheck) {
      return refusing(`The version self-check could not be completed and strict self-check is on: ${check.reason}`, "SelfCheckError");
    }
    warnings.push(`self-check skipped — ${check.reason}`);
  }

  try {
    const config = await (deps.loadConfig ?? loadConfig)({ paths });
    const api = (deps.createApi ?? ((c: Config) => createBambooHRApi(createClient(c))))(config);
    return { api, banner: `connected to ${config.companyDomain}.bamboohr.com over stdio`, warnings: [...warnings, ...config.warnings] };
  } catch (e) {
    if (e instanceof CredentialStoreError) {
      // A locked keyring or a missing helper must not take the server down.
      const reason = new Error(`${e.message}. ${e.hint} ${DESKTOP_SETTINGS_HINT} Outside Claude Desktop, run: ${enrolmentCommand()}`);
      reason.name = "CredentialStoreError";
      return { api: notEnrolledApi(reason), banner: `started without credentials — ${reason.message}`, warnings };
    }
    if (e instanceof ConfigError) {
      // Missing key, missing or malformed subdomain: the user fixes these in the
      // extension settings, so the server stays up and says so on every call.
      return { api: notEnrolledApi(e), banner: `started without credentials — ${e.message}`, warnings };
    }
    const reason = new Error(`The connector could not start: ${(e as Error).message}`);
    reason.name = "StartupError";
    return { api: notEnrolledApi(reason), banner: `serving no data — ${reason.message}`, warnings };
  }
}

/**
 * An API whose every method waits for `ready` and then delegates, so the server can
 * register its tools and answer initialize before the real API exists. `ready` holds
 * a wrapper object, not the API itself: the stand-in APIs are Proxies that answer any
 * property, `then` included, and resolving a promise with one would never settle.
 */
export function deferredApi(ready: Promise<{ api: BambooHRApi }>): BambooHRApi {
  return new Proxy({} as BambooHRApi, {
    get: (_target, prop) => {
      if (prop === "then") return undefined;
      return async (...args: unknown[]) => {
        const { api } = await ready;
        return (api[prop as keyof BambooHRApi] as (...a: unknown[]) => unknown)(...args);
      };
    },
  });
}
