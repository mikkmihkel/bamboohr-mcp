import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BambooHRApi } from "./bamboohr";
import { todayISO, type ISODate } from "./dates";
import * as employees from "./tools/employees";
import * as meta from "./tools/meta";
import * as people from "./tools/people";
import * as timeOff from "./tools/timeOff";

export function createServer(
  api: BambooHRApi,
  options: { envVacationType?: string; today?: () => ISODate } = {}
): McpServer {
  const server = new McpServer({ name: "bamboohr-mcp", version: "3.0.0" });
  const ctx = { api, today: options.today ?? (() => todayISO()), envVacationType: options.envVacationType };
  timeOff.register(server, ctx);
  meta.register(server, ctx);
  employees.register(server, ctx);
  people.register(server, ctx);
  return server;
}
