#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveAppPaths } from "./appPaths";
import { createAuditLog, type AuditLog } from "./audit";
import { isSubcommand, runCli } from "./cli";
import { notEnrolledApi } from "./notEnrolledApi";
import { createServer } from "./server";
import { defaultSettings, readSettings, SettingsError, type Settings } from "./settings";
import { deferredApi, resolveApi, type Startup } from "./startup";
import { VERSION } from "./version";

async function main() {
  const argv = process.argv.slice(2);
  if (isSubcommand(argv[0])) {
    process.exitCode = await runCli(argv);
    return;
  }

  const paths = resolveAppPaths();

  // A config.json that cannot be read must not keep the server from starting, and
  // must not be replaced by defaults either: it may hold a stricter custom-field
  // list. Start with defaults and refuse every call with the reason instead.
  let settings: Settings;
  let ready: Promise<Startup>;
  try {
    settings = readSettings(paths);
    // Started here, awaited after connect: nothing slow runs before initialize.
    ready = resolveApi(paths, settings, VERSION);
  } catch (e) {
    if (!(e instanceof SettingsError)) throw e;
    settings = defaultSettings();
    ready = Promise.resolve({ api: notEnrolledApi(e), banner: `serving no data — ${e.message}`, warnings: [] });
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

  const server = createServer(deferredApi(ready), { envVacationType: settings.vacationType, settings, audit });
  await server.connect(new StdioServerTransport());
  const startup = await ready;
  for (const warning of startup.warnings) console.error(`bamboohr-mcp: ${warning}`);
  console.error(`bamboohr-mcp: ${startup.banner}`);
}

// Always start when this file is loaded. Claude Desktop's built-in Node runtime
// loads the entry point in a way where `require.main === module` is false, and a
// guard on it left the process idle until the client's initialize timed out
// (4.0.0 regression). Nothing else imports this module: shared code lives in
// startup.ts, notEnrolledApi.ts and the other modules.
main().catch((error) => {
  console.error("bamboohr-mcp: fatal error", error);
  process.exit(1);
});
