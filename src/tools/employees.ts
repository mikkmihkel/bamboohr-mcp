import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { compact, DEFAULT_EMPLOYEE_FIELDS, MAX_REPORT_FIELDS, missingFields, REPORT_ALWAYS_FIELDS } from "../fields";
import { createTtlCache, META_TTL_MS } from "../metaCache";
import { READ_ONLY, positiveInt, run, type ToolContext } from "./shared";

const fieldName = z.string().min(1).describe("Field name, alias or numeric id from bamboohr_list_fields.");

export function register(server: McpServer, { api }: ToolContext): void {
  const cache = createTtlCache(META_TTL_MS);
  const tableAliases = () => cache.get("tables", async () => (await api.getTables()).map((t) => t.alias));

  server.registerTool(
    "bamboohr_get_employee",
    {
      title: "Get employee",
      description:
        "Read one employee's field values: standard fields (hire date, job title, supervisor, status, contact details) and custom fields (e.g. shoe size). Omit employeeId to read the API key owner's own record. Omit fields for a sensible default set. missingFields lists requested fields that came back empty or that the key may not see.",
      inputSchema: {
        employeeId: z.number().int().nonnegative().optional().describe("Internal employee id from bamboohr_list_employees. Omit or 0 for yourself."),
        fields: z.array(fieldName).min(1).max(MAX_REPORT_FIELDS).optional().describe("Fields to read. Default: name, job, department, hire date, status, contact."),
      },
      annotations: READ_ONLY,
    },
    async ({ employeeId, fields }) =>
      run(async () => {
        const wanted = fields ?? [...DEFAULT_EMPLOYEE_FIELDS];
        const { id, values } = await api.getEmployee(employeeId ?? 0, wanted);
        const { id: _drop, ...rest } = values;
        return { id, fields: compact(rest), missingFields: missingFields(wanted, values) };
      })
  );

  server.registerTool(
    "bamboohr_employee_report",
    {
      title: "Employee report",
      description:
        "Pull chosen fields for every employee in one call: e.g. hire date, department and a custom field such as shoe size for the whole company. id, displayName and status are always included. Inactive (terminated) employees are excluded unless includeInactive is true. missingFields lists fields BambooHR did not return, usually because the API key may not see them or the name is wrong; check names with bamboohr_list_fields. Filter and aggregate the rows yourself; BambooHR does not filter server-side.",
      inputSchema: {
        fields: z.array(fieldName).min(1).max(MAX_REPORT_FIELDS - REPORT_ALWAYS_FIELDS.length).describe("Fields to include."),
        employeeIds: z.array(positiveInt).optional().describe("Restrict to these employee ids."),
        includeInactive: z.boolean().optional().describe("Include employees whose status is not Active. Default false."),
      },
      annotations: READ_ONLY,
    },
    async ({ fields, employeeIds, includeInactive }) =>
      run(async () => {
        const requested = [...REPORT_ALWAYS_FIELDS, ...fields.filter((f) => !(REPORT_ALWAYS_FIELDS as readonly string[]).includes(f))];
        const report = await api.runCustomReport(requested, employeeIds);
        const returned = new Set(report.fields.map((f) => f.id));
        const missing = fields.filter((f) => !returned.has(f));
        if (missing.length === fields.length) {
          throw new Error(
            `BambooHR returned none of the requested fields (${fields.join(", ")}). Either the API key's access level hides them or the field names are wrong; check them with bamboohr_list_fields.`
          );
        }
        const employees = includeInactive ? report.employees : report.employees.filter((e) => e.status === "Active");
        return {
          fields: report.fields,
          employees,
          missingFields: missing,
          totalEmployees: report.employees.length,
          returnedEmployees: employees.length,
        };
      })
  );

  server.registerTool(
    "bamboohr_table_rows",
    {
      title: "Table rows",
      description:
        "Read the rows of an employee table for one employee or for everyone: job history (jobInfo), compensation, employmentStatus, or any custom table (e.g. equipment, certificates). Get valid table aliases from bamboohr_list_tables. Rows are unsorted; sort by date yourself.",
      inputSchema: {
        table: z.string().min(1).describe("Table alias, e.g. jobInfo, compensation, employmentStatus, customEquipment."),
        employeeId: positiveInt.optional().describe("Internal employee id. Omit for all employees the key may see."),
      },
      annotations: READ_ONLY,
    },
    async ({ table, employeeId }) =>
      run(async () => {
        const aliases = await tableAliases();
        if (!aliases.includes(table)) {
          throw new Error(`Unknown table "${table}". Valid tables: ${aliases.join(", ")}`);
        }
        const rows = await api.getTableRows(table, employeeId ?? "all");
        return { table, rows };
      })
  );

  server.registerTool(
    "bamboohr_changed_employees",
    {
      title: "Changed employees",
      description:
        "List employees whose record changed since a timestamp: new hires (Inserted), edits to any field or to job, compensation or employment status tables (Updated), and removals (Deleted). Newest first. Use bamboohr_get_employee to see the current values.",
      inputSchema: {
        since: z.string().min(10).describe("ISO 8601 date or date-time, e.g. 2026-09-01 or 2026-09-01T00:00:00+00:00."),
        type: z.enum(["inserted", "updated", "deleted"]).optional().describe("Only this change type. Default: all."),
      },
      annotations: READ_ONLY,
    },
    async ({ since, type }) =>
      run(() => api.getChangedEmployees(since.length === 10 ? `${since}T00:00:00+00:00` : since, type))
  );
}
