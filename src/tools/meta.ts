import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mergeFieldOptions, searchFields } from "../fields";
import { ALLOWED_STANDARD_FIELDS, enforceRecordLimit, isBlockedKey, isBlockedTable } from "../policy";
import type { BambooUser, FieldMeta } from "../types";
import { READ_ONLY, assertRange, isoDate, run, type ToolContext } from "./shared";

/** True when this field may actually be requested from BambooHR (same rule as policy.resolveAllowedFields). */
function isAllowedField(field: FieldMeta): boolean {
  const alias = field.alias;
  if (alias !== undefined && ALLOWED_STANDARD_FIELDS.has(alias)) return true;
  return (
    alias !== undefined &&
    alias.toLowerCase().startsWith("custom") &&
    !isBlockedKey(alias) &&
    !isBlockedKey(field.name)
  );
}

function matchesUser(user: BambooUser, needle: string): boolean {
  const haystack = `${user.firstName} ${user.lastName} ${user.email ?? ""}`.toLowerCase();
  return haystack.includes(needle);
}

export function register(server: McpServer, ctx: ToolContext): void {
  const { api, today } = ctx;
  const maxRecords = () => ctx.settings.maxRecords;

  server.registerTool(
    "bamboohr_list_fields",
    {
      title: "List employee fields",
      description:
        "List every employee field in this BambooHR account, standard and custom, with id, name, API alias, type and an `allowed` flag. Only fields with allowed:true can be read by bamboohr_get_employee or bamboohr_employee_report; the rest (pay, bank, national id, date of birth, gender, home contact details) are refused by policy. Use search to find a field by name (e.g. 'shoe', 'hire'). Set includeOptions to see the allowed values of list fields.",
      inputSchema: {
        search: z.string().optional().describe("Case-insensitive substring of the field name or alias."),
        includeOptions: z.boolean().optional().describe("Attach the option list of list-type fields. Default false."),
      },
      annotations: READ_ONLY,
    },
    async ({ search, includeOptions }) =>
      run(
        ctx,
        { tool: "bamboohr_list_fields", filters: { search: search ? true : undefined, includeOptions } },
        async () => {
          let fields = await api.getFields();
          if (includeOptions) fields = mergeFieldOptions(fields, await api.getListFields());
          return searchFields(fields, search).map((f) => ({ ...f, allowed: isAllowedField(f) }));
        }
      )
  );

  server.registerTool(
    "bamboohr_list_tables",
    {
      title: "List employee tables",
      description:
        "List the tabular fields this server may read (job history, employment status, and custom tables such as equipment or certificates) with the table alias and its columns. Compensation, bonus, commission, bank and similar tables are excluded by policy and are not listed. Use the alias with bamboohr_table_rows.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      run(ctx, { tool: "bamboohr_list_tables" }, async () =>
        (await api.getTables()).filter((t) => !isBlockedTable(t.alias))
      )
  );

  server.registerTool(
    "bamboohr_company_holidays",
    {
      title: "Company holidays",
      description:
        "List company holidays that overlap a date range. Default: the current calendar year. Multi-day holidays that overlap the range are included.",
      inputSchema: {
        start: isoDate.optional().describe("Range start, YYYY-MM-DD. Default: 1 January of the current year."),
        end: isoDate.optional().describe("Range end, YYYY-MM-DD. Default: 31 December of the current year."),
      },
      annotations: READ_ONLY,
    },
    async ({ start, end }) =>
      run(ctx, { tool: "bamboohr_company_holidays", filters: { start, end } }, async () => {
        const year = today().slice(0, 4);
        const s = start ?? `${year}-01-01`;
        const e = end ?? `${year}-12-31`;
        assertRange(s, e);
        return api.getHolidays(s, e);
      })
  );

  server.registerTool(
    "bamboohr_list_users",
    {
      title: "List BambooHR users",
      description:
        "List BambooHR user accounts (people who can log in) with their linked employee id, email, status and last login. Useful for access reviews: who has an enabled account, who never logged in. Narrow the list with status or search; more accounts than the per-call record limit are refused.",
      inputSchema: {
        status: z.enum(["enabled", "disabled"]).optional().describe("Only accounts with this status. Default: all."),
        search: z.string().min(1).optional().describe("Case-insensitive substring of the first name, last name or email."),
      },
      annotations: READ_ONLY,
    },
    async ({ status, search }) =>
      run(
        ctx,
        // The search text is a value typed by the user: only the fact that one was used is logged.
        { tool: "bamboohr_list_users", filters: { status, search: search ? true : undefined } },
        async () => {
          const users = await api.getUsers(status);
          const needle = search?.trim().toLowerCase();
          const filtered = needle ? users.filter((u) => matchesUser(u, needle)) : users;
          enforceRecordLimit(filtered.length, maxRecords(), "Filter by status or add a search word.");
          return filtered;
        }
      )
  );
}
