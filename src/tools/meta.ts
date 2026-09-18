import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mergeFieldOptions, searchFields } from "../fields";
import { READ_ONLY, assertRange, isoDate, run, type ToolContext } from "./shared";

export function register(server: McpServer, { api, today }: ToolContext): void {
  server.registerTool(
    "bamboohr_list_fields",
    {
      title: "List employee fields",
      description:
        "List every employee field in this BambooHR account, standard and custom, with id, name, API alias and type. Use search to find a field by name (e.g. 'shoe', 'hire'). Set includeOptions to see the allowed values of list fields. Pass the alias or id to bamboohr_get_employee or bamboohr_employee_report.",
      inputSchema: {
        search: z.string().optional().describe("Case-insensitive substring of the field name or alias."),
        includeOptions: z.boolean().optional().describe("Attach the option list of list-type fields. Default false."),
      },
      annotations: READ_ONLY,
    },
    async ({ search, includeOptions }) =>
      run(async () => {
        let fields = await api.getFields();
        if (includeOptions) fields = mergeFieldOptions(fields, await api.getListFields());
        return searchFields(fields, search);
      })
  );

  server.registerTool(
    "bamboohr_list_tables",
    {
      title: "List employee tables",
      description:
        "List every tabular field in BambooHR (job history, compensation, employment status, and custom tables such as equipment or certificates) with the table alias and its columns. Use the alias with bamboohr_table_rows.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => run(() => api.getTables())
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
      run(async () => {
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
        "List BambooHR user accounts (people who can log in) with their linked employee id, email, status and last login. Useful for access reviews: who has an enabled account, who never logged in.",
      inputSchema: {
        status: z.enum(["enabled", "disabled"]).optional().describe("Only accounts with this status. Default: all."),
      },
      annotations: READ_ONLY,
    },
    async ({ status }) => run(() => api.getUsers(status))
  );
}
