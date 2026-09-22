#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveAppPaths } from "./appPaths";
import { createAuditLog, type AuditLog } from "./audit";
import { createBambooHRApi, type BambooHRApi } from "./bamboohr";
import { notEnrolledApi } from "./notEnrolledApi";
import { createClient } from "./client";
import { isSubcommand, runCli } from "./cli";
import { ConfigError, DESKTOP_SETTINGS_HINT, enrolmentCommand, loadConfig } from "./config";
import { CredentialStoreError } from "./credentialStore";
import { runSelfCheck } from "./selfCheck";
import { createServer } from "./server";
import { DEFAULT_REVOCATION_URL, readSettings } from "./settings";
import { VERSION } from "./version";

const EXIT_SELF_CHECK = 3;

async function main() {
  const argv = process.argv.slice(2);
  if (isSubcommand(argv[0])) {
    process.exitCode = await runCli(argv);
    return;
  }

  const paths = resolveAppPaths();
  const settings = readSettings(paths);

  // Revocation check before anything else connects: a build that is known bad
  // must not start. The request carries no credentials (see selfCheck.ts).
  let selfCheck;
  try {
    selfCheck = await runSelfCheck(settings.revocationUrl ?? DEFAULT_REVOCATION_URL, VERSION);
  } catch (e) {
    selfCheck = { status: "unavailable" as const, reason: (e as Error).message };
  }
  if (selfCheck.status === "revoked") {
    console.error(`bamboohr-mcp: refusing to start — ${selfCheck.reason}`);
    process.exit(EXIT_SELF_CHECK);
  }
  if (selfCheck.status === "unavailable") {
    if (settings.strictSelfCheck) {
      console.error(`bamboohr-mcp: refusing to start — ${selfCheck.reason} (strict self-check is on)`);
      process.exit(EXIT_SELF_CHECK);
    }
    console.error(`bamboohr-mcp: self-check skipped — ${selfCheck.reason}`);
  }

  let api: BambooHRApi;
  let banner: string;
  try {
    const config = await loadConfig({ paths });
    api = createBambooHRApi(createClient(config));
    for (const warning of config.warnings) console.error(`bamboohr-mcp: ${warning}`);
    banner = `connected to ${config.companyDomain}.bamboohr.com over stdio`;
  } catch (e) {
    if (e instanceof CredentialStoreError) {
      // A locked keyring or a missing helper must not take the server down:
      // start, list the tools, and answer every call with the reason.
      const reason = new Error(`${e.message}. ${e.hint} ${DESKTOP_SETTINGS_HINT} Outside Claude Desktop, run: ${enrolmentCommand()}`);
      reason.name = "CredentialStoreError"; // the audit log records the class name only
      api = notEnrolledApi(reason);
      banner = `started without credentials — ${reason.message}`;
    } else if (e instanceof ConfigError) {
      // Missing key, missing or malformed subdomain: all of them are things the
      // user fixes in the extension settings, so the server has to stay up and
      // say so on every call. Exiting here left Claude Desktop showing nothing
      // but a failed connector.
      api = notEnrolledApi(e);
      banner = `started without credentials — ${e.message}`;
    } else {
      throw e;
    }
  }

  // The audit log is best effort: a log that cannot be opened must never keep
  // the server from starting, so fall back to a sink that drops every entry.
  let audit: AuditLog;
  try {
    audit = createAuditLog({ logDir: paths.logDir, saltFile: paths.saltFile });
  } catch (e) {
    console.error(`bamboohr-mcp: audit log unavailable — ${(e as Error).message}`);
    audit = { dir: paths.logDir, file: "", write: () => {}, hashEmployeeId: () => "" };
  }

  const server = createServer(api, { envVacationType: settings.vacationType, settings, audit });
  await server.connect(new StdioServerTransport());
  console.error(`bamboohr-mcp: ${banner}`);
}

// Always start when this file is loaded. Claude Desktop's built-in Node runtime
// loads the entry point in a way where `require.main === module` is false, and a
// guard on it left the process idle until the client's initialize timed out
// (4.0.0 regression). Nothing else imports this module: shared code lives in
// notEnrolledApi.ts and the other modules.
main().catch((error) => {
  console.error("bamboohr-mcp: fatal error", error);
  process.exit(1);
});
