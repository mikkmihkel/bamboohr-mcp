import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { compact, DEFAULT_EMPLOYEE_FIELDS, MAX_REPORT_FIELDS, missingFields, REPORT_ALWAYS_FIELDS } from "../fields";
import { assertAllFieldsAllowed, enforceRecordLimit, isBlockedTable, PolicyError, requireFilter } from "../policy";
import type { ReportRow } from "../types";
import { READ_ONLY, positiveInt, run, type ToolContext } from "./shared";

const fieldName = z.string().min(1).describe("Field name, alias or numeric id from bamboohr_list_fields.");

/** Exact, case-insensitive match on an organisational column, applied to the report rows. */
function matchesColumn(row: ReportRow, column: string, wanted: string): boolean {
  const value = row[column];
  return typeof value === "string" && value.trim().toLowerCase() === wanted.trim().toLowerCase();
}

export function register(server: McpServer, ctx: ToolContext): void {
  const { api } = ctx;
  const maxRecords = () => ctx.settings.maxRecords;

  server.registerTool(
    "bamboohr_get_employee",
    {
      title: "Get employee",
      description:
        "Read one employee's field values: standard fields (hire date, job title, supervisor, status, work contact details) and custom fields (e.g. shoe size). Omit employeeId to read the API key owner's own record. Omit fields for a sensible default set. Fields outside the allow-list — pay, bank, national id, date of birth, gender, home contact details — are refused and nothing is returned; ask for other fields instead. missingFields lists requested fields that came back empty or that the key may not see.",
      inputSchema: {
        employeeId: z.number().int().nonnegative().optional().describe("Internal employee id from bamboohr_list_employees. Omit or 0 for yourself."),
        fields: z.array(fieldName).min(1).max(MAX_REPORT_FIELDS).optional().describe("Fields to read; only allow-listed and custom fields are permitted. Default: name, job, department, hire date, status, work contact."),
      },
      annotations: READ_ONLY,
    },
    async ({ employeeId, fields }) => {
      const wanted = fields ?? [...DEFAULT_EMPLOYEE_FIELDS];
      return run(
        ctx,
        { tool: "bamboohr_get_employee", fields: wanted, employeeIds: [employeeId ?? 0], count: () => 1 },
        async () => {
          // Refused fields are never sent to BambooHR: the check happens before the call.
          const allowed = assertAllFieldsAllowed(wanted, await ctx.fieldMeta());
          const { id, values } = await api.getEmployee(employeeId ?? 0, allowed);
          const { id: _drop, ...rest } = values;
          // excludedFields is always empty (an excluded field refuses the whole call); the key
          // stays in the payload so the response shape does not change between versions.
          return { id, fields: compact(rest), missingFields: missingFields(allowed, values), excludedFields: [] };
        }
      );
    }
  );

  server.registerTool(
    "bamboohr_employee_report",
    {
      title: "Employee report",
      description:
        "Pull chosen fields for a bounded group of employees in one call: e.g. hire date and a custom field such as shoe size for one department. Requires either employeeIds or a department, location or division filter (exact name, case-insensitive); company-wide reports are refused. At most the configured per-call record limit of rows is returned, otherwise the call is refused — narrow the filter. Only allow-listed and custom fields may be requested; pay, bank, birth date and similar fields are refused. id, displayName and status are always included. Inactive (terminated) employees are excluded unless includeInactive is true. missingFields lists fields BambooHR did not return, usually because the API key may not see them or the name is wrong; check names with bamboohr_list_fields.",
      inputSchema: {
        fields: z.array(fieldName).min(1).max(MAX_REPORT_FIELDS - REPORT_ALWAYS_FIELDS.length).describe("Fields to include."),
        employeeIds: z.array(positiveInt).optional().describe("Restrict to these employee ids (at most the per-call record limit)."),
        department: z.string().min(1).optional().describe("Only employees in this department (exact name, case-insensitive)."),
        location: z.string().min(1).optional().describe("Only employees in this location (exact name, case-insensitive)."),
        division: z.string().min(1).optional().describe("Only employees in this division (exact name, case-insensitive)."),
        includeInactive: z.boolean().optional().describe("Include employees whose status is not Active. Default false."),
      },
      annotations: READ_ONLY,
    },
    async ({ fields, employeeIds, department, location, division, includeInactive }) =>
      run(
        ctx,
        {
          tool: "bamboohr_employee_report",
          fields,
          filters: { department, location, division, includeInactive },
          employeeIds,
          count: (r: { employees: unknown[] }) => r.employees.length,
        },
        async () => {
          const max = maxRecords();
          requireFilter(
            Boolean(employeeIds?.length || department || location || division),
            `bamboohr_employee_report requires employeeIds (max ${max}) or a department, location or division filter; unbounded company-wide reports are not allowed.`
          );
          if (employeeIds?.length) {
            enforceRecordLimit(employeeIds.length, max, "Ask for fewer employeeIds, or use a department, location or division filter.");
          }

          const allowed = assertAllFieldsAllowed(fields, await ctx.fieldMeta());
          const always = REPORT_ALWAYS_FIELDS as readonly string[];
          // The columns the filters compare against must be in the report, because BambooHR
          // does not filter server-side — the rows are narrowed here instead.
          const filters: [string, string][] = [];
          if (department) filters.push(["department", department]);
          if (location) filters.push(["location", location]);
          if (division) filters.push(["division", division]);

          const requested = [...always];
          for (const f of [...allowed, ...filters.map(([column]) => column)]) {
            if (!requested.includes(f)) requested.push(f);
          }

          const report = await api.runCustomReport(requested, employeeIds);
          const returned = new Set(report.fields.map((f) => f.id));
          const missing = allowed.filter((f) => !returned.has(f));
          if (missing.length === allowed.length) {
            throw new Error(
              `BambooHR returned none of the requested fields (${allowed.join(", ")}). Either the API key's access level hides them or the field names are wrong; check them with bamboohr_list_fields.`
            );
          }

          let rows = report.employees;
          for (const [column, wanted] of filters) rows = rows.filter((r) => matchesColumn(r, column, wanted));
          const employees = includeInactive ? rows : rows.filter((e) => e.status === "Active");
          enforceRecordLimit(
            employees.length,
            max,
            "Narrow the filter (smaller department/location, fewer employeeIds) or raise maxRecords at enrolment."
          );

          return {
            fields: report.fields,
            employees,
            missingFields: missing,
            totalEmployees: report.employees.length,
            returnedEmployees: employees.length,
            excludedFields: [],
          };
        }
      )
  );

  server.registerTool(
    "bamboohr_table_rows",
    {
      title: "Table rows",
      description:
        "Read the rows of an employee table for ONE employee: job history (jobInfo), employmentStatus, or any custom table (e.g. equipment, certificates). employeeId is required. Pay, compensation, bonus, commission, bank and similar tables are excluded by policy and are refused. Get valid table aliases from bamboohr_list_tables. Rows are unsorted; sort by date yourself.",
      inputSchema: {
        table: z.string().min(1).describe("Table alias, e.g. jobInfo, employmentStatus, customEquipment."),
        employeeId: positiveInt.describe("Internal employee id. Required: this tool reads one employee at a time."),
      },
      annotations: READ_ONLY,
    },
    async ({ table, employeeId }) =>
      run(
        ctx,
        { tool: "bamboohr_table_rows", filters: { table }, employeeIds: [employeeId], count: (r: { rows: unknown[] }) => r.rows.length },
        async () => {
          // Checked before the metadata lookup, so an excluded table is refused even when
          // BambooHR's metadata endpoint is unavailable.
          if (isBlockedTable(table)) {
            throw new PolicyError(
              "table_excluded",
              `Table "${table}" is excluded by policy (compensation, bonus, commission, bank and similar tables are never read).`
            );
          }
          const aliases = await ctx.tableAliases();
          if (!aliases.includes(table)) {
            throw new Error(`Unknown table "${table}". Valid tables: ${aliases.join(", ")}`);
          }
          const rows = await api.getTableRows(table, employeeId);
          return { table, rows };
        }
      )
  );

  server.registerTool(
    "bamboohr_changed_employees",
    {
      title: "Changed employees",
      description:
        "List employees whose record changed since a timestamp: new hires (Inserted), edits to any field or table (Updated), and removals (Deleted). Ids and timestamps only, no field values. Newest first. Use bamboohr_get_employee to see the current values.",
      inputSchema: {
        since: z.string().min(10).describe("ISO 8601 date or date-time, e.g. 2026-09-01 or 2026-09-01T00:00:00+00:00."),
        type: z.enum(["inserted", "updated", "deleted"]).optional().describe("Only this change type. Default: all."),
      },
      annotations: READ_ONLY,
    },
    async ({ since, type }) =>
      run(
        ctx,
        {
          tool: "bamboohr_changed_employees",
          filters: { since, type },
          count: (r: { employees: unknown[] }) => r.employees.length,
        },
        () => api.getChangedEmployees(since.length === 10 ? `${since}T00:00:00+00:00` : since, type)
      )
  );
}
