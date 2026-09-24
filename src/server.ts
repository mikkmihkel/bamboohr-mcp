import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuditLog } from "./audit";
import type { BambooHRApi } from "./bamboohr";
import { todayISO, type ISODate } from "./dates";
import { createTtlCache, META_TTL_MS } from "./metaCache";
import { isBlockedTable } from "./policy";
import { DEFAULT_MAX_RECORDS, type Settings } from "./settings";
import * as employees from "./tools/employees";
import * as meta from "./tools/meta";
import * as people from "./tools/people";
import type { ToolContext } from "./tools/shared";
import * as timeOff from "./tools/timeOff";
import { VERSION } from "./version";

export interface ServerOptions {
  envVacationType?: string;
  today?: () => ISODate;
  /** Merged over the defaults; the cap and the sensitive-tool gate reach the tools from here. */
  settings?: Partial<Settings>;
  audit?: AuditLog;
}

/** Used when no audit log is configured (tests, embedding callers): drops every entry. */
const NO_AUDIT: AuditLog = {
  dir: "",
  file: "",
  write: () => {},
  hashEmployeeId: (id) => String(id),
};

function resolveSettings(partial: Partial<Settings> | undefined): Settings {
  return {
    enableSensitiveTools: false,
    maxRecords: DEFAULT_MAX_RECORDS,
    strictSelfCheck: false,
    ...partial,
  };
}

export function createServer(api: BambooHRApi, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "bamboohr-mcp", version: VERSION });
  const settings = resolveSettings(options.settings);

  // One metadata cache for the whole server: field and table metadata barely changes, and a
  // single HR question can need it in several tools.
  const cache = createTtlCache(META_TTL_MS);
  const ctx: ToolContext = {
    api,
    today: options.today ?? (() => todayISO()),
    envVacationType: options.envVacationType ?? settings.vacationType,
    settings,
    audit: options.audit ?? NO_AUDIT,
    // FieldMeta carries the BambooHR field `type`, which the policy needs: a custom field of
    // type currency/ssn/gender is refused however innocuous its name is.
    fieldMeta: () => cache.get("fields", () => api.getFields()),
    tables: () => cache.get("tables", async () => (await api.getTables()).filter((t) => !isBlockedTable(t.alias))),
  };

  timeOff.register(server, ctx);
  meta.register(server, ctx);
  employees.register(server, ctx);
  people.register(server, ctx);
  return server;
}
