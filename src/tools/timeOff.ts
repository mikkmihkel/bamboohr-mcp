import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addDays } from "../dates";
import { buildVacationOverview } from "../overview";
import { READ_ONLY, assertRange, isoDate, positiveInt, run, type ToolContext } from "./shared";

const STATUS_VALUES = ["approved", "denied", "superceded", "requested", "canceled"] as const;

export function register(server: McpServer, { api, today, envVacationType }: ToolContext): void {
  server.registerTool(
    "bamboohr_whos_out",
    {
      title: "Who's out",
      description:
        "List employees who are out of office and company holidays in a date range. Defaults to today through 14 days ahead. Each entry has type 'timeOff' (with employeeId and employee name) or 'holiday' (holiday name only).",
      inputSchema: {
        start: isoDate.optional().describe("First day of the range, YYYY-MM-DD. Default: today."),
        end: isoDate.optional().describe("Last day of the range, YYYY-MM-DD. Default: start + 14 days."),
      },
      annotations: READ_ONLY,
    },
    async ({ start, end }) =>
      run(async () => {
        const s = start ?? today();
        const e = end ?? addDays(s, 14);
        assertRange(s, e);
        return api.getWhosOut(s, e);
      })
  );

  server.registerTool(
    "bamboohr_list_employees",
    {
      title: "List employees",
      description:
        "List current employees from the BambooHR directory with id, name, job title, department, division, location, supervisor and work email. Use the id with the balance and request tools.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => run(() => api.getDirectory())
  );

  server.registerTool(
    "bamboohr_list_time_off_types",
    {
      title: "List time-off types",
      description:
        "List the company's time-off types (e.g. vacation, sick leave) with their ids and units, plus the default hours per weekday. Use this to find the right type name or id for other tools.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => run(() => api.getTimeOffTypes())
  );

  server.registerTool(
    "bamboohr_time_off_balances",
    {
      title: "Time-off balances",
      description:
        "Get one employee's time-off balances for every assigned type as of a date, including amount used year-to-date. Use a future date to project the balance.",
      inputSchema: {
        employeeId: positiveInt.describe("Internal BambooHR employee id (from bamboohr_list_employees)."),
        asOf: isoDate.optional().describe("Calculate the balance as of this date, YYYY-MM-DD. Default: today."),
      },
      annotations: READ_ONLY,
    },
    async ({ employeeId, asOf }) => run(() => api.getBalances(employeeId, asOf ?? today()))
  );

  server.registerTool(
    "bamboohr_time_off_requests",
    {
      title: "Time-off requests",
      description:
        "List time-off requests overlapping a date range, optionally filtered by employee, status and time-off type. Results are limited to employees the API key's owner may see in BambooHR.",
      inputSchema: {
        start: isoDate.describe("Range start, YYYY-MM-DD."),
        end: isoDate.describe("Range end, YYYY-MM-DD."),
        employeeId: positiveInt.optional().describe("Limit to one employee."),
        status: z.array(z.enum(STATUS_VALUES)).optional().describe("Limit to these statuses. Default: all."),
        timeOffTypeId: z.string().optional().describe("Limit to one time-off type id (see bamboohr_list_time_off_types)."),
      },
      annotations: READ_ONLY,
    },
    async ({ start, end, employeeId, status, timeOffTypeId }) =>
      run(async () => {
        assertRange(start, end);
        return api.getTimeOffRequests({
          start,
          end,
          employeeId,
          status,
          typeIds: timeOffTypeId ? [timeOffTypeId] : undefined,
        });
      })
  );

  server.registerTool(
    "bamboohr_vacation_overview",
    {
      title: "Vacation overview",
      description:
        "Company-wide vacation report for one calendar year. For every current employee: vacation balance as of a date, used year-to-date, vacation planned after that date (approved or requested), unplanned balance (balance minus planned), the longest continuous vacation block in calendar days, and whether they have at least one 14-day continuous block. Adjacent requests are merged into one block. Use onlyMissingFourteenDayBlock to list only employees who have not taken or booked a 14-day vacation. The summary counts all employees before the onlyMissingFourteenDayBlock filter is applied. Note: planned vacation excludes a request already in progress on the as-of date, on the assumption that BambooHR's balance has already deducted it.",
      inputSchema: {
        year: z.number().int().min(2000).max(2100).optional().describe("Calendar year. Default: current year."),
        asOf: isoDate.optional().describe("Balance date, YYYY-MM-DD, must be inside the year. Default: today (or Dec 31 for past years)."),
        department: z.string().optional().describe("Only employees in this department (exact name, case-insensitive)."),
        timeOffType: z.string().optional().describe("Vacation time-off type name or id. Default: BAMBOOHR_VACATION_TYPE, else a type named like 'vacation' or 'puhkus'."),
        onlyMissingFourteenDayBlock: z.boolean().optional().describe("Return only employees without a 14-day continuous block."),
      },
      annotations: READ_ONLY,
    },
    async (input) =>
      run(() => buildVacationOverview(api, input, { envVacationType, today: today() }))
  );
}
