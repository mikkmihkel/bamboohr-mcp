import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addDays } from "../dates";
import { createTtlCache, META_TTL_MS } from "../metaCache";
import { buildVacationOverview } from "../overview";
import { enforceRecordLimit, isSickType, PolicyError, reduceSickRequest, requireFilter } from "../policy";
import type { DirectoryEmployee } from "../types";
import { READ_ONLY, assertRange, isoDate, positiveInt, run, type ToolContext } from "./shared";

const STATUS_VALUES = ["approved", "denied", "superceded", "requested", "canceled"] as const;

/** Filters are compared after trimming, so "  " is not accepted as a filter at all. */
const filterText = z.string().trim().min(1);

/** A BambooHR time-off type id is a small integer; anything else is free text in disguise. */
const timeOffTypeIdSchema = z.string().regex(/^\d{1,10}$/, "must be a numeric time-off type id");

function matchesSearch(e: DirectoryEmployee, needle: string): boolean {
  const haystack = `${e.displayName ?? ""} ${e.firstName ?? ""} ${e.lastName ?? ""} ${e.workEmail ?? ""}`.toLowerCase();
  return haystack.includes(needle);
}

function sameName(value: string | undefined, wanted: string): boolean {
  return (value ?? "").trim().toLowerCase() === wanted.trim().toLowerCase();
}

export function register(server: McpServer, ctx: ToolContext): void {
  const { api, today, envVacationType } = ctx;
  const maxRecords = () => ctx.settings.maxRecords;
  // Time-off types change about as often as field metadata; one short-lived cache for both the
  // list tool and the health-related-type check below.
  const cache = createTtlCache(META_TTL_MS);
  const timeOffTypes = () => cache.get("timeOffTypes", () => api.getTimeOffTypes());

  server.registerTool(
    "bamboohr_whos_out",
    {
      title: "Who's out",
      description:
        "List employees who are out of office and company holidays in a date range. Defaults to today through 14 days ahead. Each entry has type 'timeOff' (with employeeId and employee name) or 'holiday' (holiday name only). A range with more people out than the per-call record limit is refused (holidays do not count); use a shorter range.",
      inputSchema: {
        start: isoDate.optional().describe("First day of the range, YYYY-MM-DD. Default: today."),
        end: isoDate.optional().describe("Last day of the range, YYYY-MM-DD. Default: start + 14 days."),
      },
      annotations: READ_ONLY,
    },
    async ({ start, end }) =>
      run(ctx, { tool: "bamboohr_whos_out", filters: { start, end } }, async () => {
        const s = start ?? today();
        const e = end ?? addDays(s, 14);
        assertRange(s, e);
        const entries = await api.getWhosOut(s, e);
        // Holidays are not personal data and do not count toward the cap.
        enforceRecordLimit(entries.filter((x) => x.type === "timeOff").length, maxRecords(), "Use a shorter date range.");
        return entries;
      })
  );

  server.registerTool(
    "bamboohr_list_employees",
    {
      title: "List employees",
      description:
        "Look up employees in the BambooHR directory with id, name, job title, department, division, location, supervisor and work email. Requires search, department or location — listing the whole company in one call is not allowed — and returns at most the per-call record limit of people. Use the id with the balance and request tools.",
      inputSchema: {
        search: filterText.optional().describe("Case-insensitive substring of the name or work email."),
        department: filterText.optional().describe("Only employees in this department (exact name, case-insensitive)."),
        location: filterText.optional().describe("Only employees in this location (exact name, case-insensitive)."),
      },
      annotations: READ_ONLY,
    },
    async ({ search, department, location }) =>
      run(
        ctx,
        // Only the fact that a search word was used is logged, never the word itself.
        { tool: "bamboohr_list_employees", filters: { department, location, search: search ? true : undefined } },
        async () => {
          // Tested on the trimmed values: a filter of spaces is no filter.
          const needle = search?.trim().toLowerCase();
          requireFilter(
            Boolean(needle || department?.trim() || location?.trim()),
            "bamboohr_list_employees requires search, department or location; listing the whole company is not allowed."
          );
          let people = await api.getDirectory();
          if (needle) people = people.filter((e) => matchesSearch(e, needle));
          if (department) people = people.filter((e) => sameName(e.department, department));
          if (location) people = people.filter((e) => sameName(e.location, location));
          enforceRecordLimit(people.length, maxRecords(), "Add a more specific search word or a department/location filter.");
          return people;
        }
      )
  );

  server.registerTool(
    "bamboohr_list_time_off_types",
    {
      title: "List time-off types",
      description:
        "List the company's time-off types (e.g. vacation, unpaid leave) with their ids and units, plus the default hours per weekday. Use this to find the right type name or id for other tools. Health-related types (sick leave, care leave and similar) are excluded by policy and are not listed; health-related absences appear elsewhere as a generic 'absent'.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      run(
        ctx,
        { tool: "bamboohr_list_time_off_types", count: (r: { timeOffTypes: unknown[] }) => r.timeOffTypes.length },
        async () => {
          // Listing the sick-leave type is itself a health disclosure — and it hands the model
          // the very type id that the request tool refuses.
          const { timeOffTypes: types, defaultHours } = await timeOffTypes();
          return { timeOffTypes: types.filter((t) => !isSickType(t.name)), defaultHours };
        }
      )
  );

  server.registerTool(
    "bamboohr_time_off_balances",
    {
      title: "Time-off balances",
      description:
        "Get one employee's time-off balances as of a date, including amount used year-to-date. Use a future date to project the balance. Health-related balances (sick leave and similar) are not reported.",
      inputSchema: {
        employeeId: positiveInt.describe("Internal BambooHR employee id (from bamboohr_list_employees)."),
        asOf: isoDate.optional().describe("Calculate the balance as of this date, YYYY-MM-DD. Default: today."),
      },
      annotations: READ_ONLY,
    },
    async ({ employeeId, asOf }) =>
      run(ctx, { tool: "bamboohr_time_off_balances", filters: { asOf }, employeeIds: [employeeId] }, async () => {
        const balances = await api.getBalances(employeeId, asOf ?? today());
        // A sick-leave balance says how much health-related absence a person has taken.
        return balances.filter((b) => !isSickType(b.name));
      })
  );

  server.registerTool(
    "bamboohr_time_off_requests",
    {
      title: "Time-off requests",
      description:
        "List time-off requests overlapping a date range, optionally filtered by employee, status and time-off type. Health-related absences are reduced to type 'absent' with no notes. Results are limited to employees the API key's owner may see, and to the per-call record limit.",
      inputSchema: {
        start: isoDate.describe("Range start, YYYY-MM-DD."),
        end: isoDate.describe("Range end, YYYY-MM-DD."),
        employeeId: positiveInt.optional().describe("Limit to one employee."),
        status: z.array(z.enum(STATUS_VALUES)).optional().describe("Limit to these statuses. Default: all."),
        timeOffTypeId: timeOffTypeIdSchema.optional().describe("Limit to one time-off type id (see bamboohr_list_time_off_types)."),
      },
      annotations: READ_ONLY,
    },
    async ({ start, end, employeeId, status, timeOffTypeId }) =>
      run(
        ctx,
        {
          tool: "bamboohr_time_off_requests",
          filters: { start, end, status, timeOffTypeId },
          employeeIds: [employeeId],
        },
        async () => {
          assertRange(start, end);
          // A health-related type id must not be usable as a filter: "show me every request of
          // type 3" would otherwise be a list of who was ill, whatever the reduction does later.
          if (timeOffTypeId !== undefined) {
            const { timeOffTypes: types } = await timeOffTypes();
            const match = types.find((t) => t.id === timeOffTypeId);
            if (match && isSickType(match.name)) {
              throw new PolicyError(
                "tool_disabled",
                `Time-off type ${timeOffTypeId} is health-related and excluded by policy; sick leave is only shown as a generic absence.`
              );
            }
          }
          const requests = await api.getTimeOffRequests({
            start,
            end,
            employeeId,
            status,
            typeIds: timeOffTypeId ? [timeOffTypeId] : undefined,
          });
          const reduced = requests.map(reduceSickRequest);
          enforceRecordLimit(reduced.length, maxRecords(), "Use a shorter range, one employeeId or a status filter.");
          return reduced;
        }
      )
  );

  server.registerTool(
    "bamboohr_vacation_overview",
    {
      title: "Vacation overview",
      description:
        "Vacation report for one department (or a list of employeeIds) and one calendar year: vacation balance as of a date, used year-to-date, vacation planned after that date (approved or requested), unplanned balance (balance minus planned), the longest continuous vacation block in calendar days, and whether they have at least one 14-day continuous block. Adjacent requests are merged into one block. A department or employeeIds is required — a company-wide overview in one call is not allowed, ask per department — and the group must fit the per-call record limit. Use onlyMissingFourteenDayBlock to list only employees without a 14-day vacation. The summary counts all employees before that filter. Note: planned vacation excludes a request already in progress on the as-of date, on the assumption that BambooHR's balance has already deducted it.",
      inputSchema: {
        year: z.number().int().min(2000).max(2100).optional().describe("Calendar year. Default: current year."),
        asOf: isoDate.optional().describe("Balance date, YYYY-MM-DD, must be inside the year. Default: today (or Dec 31 for past years)."),
        department: filterText.optional().describe("Only employees in this department (exact name, case-insensitive)."),
        employeeIds: z.array(positiveInt).optional().describe("Only these employees. Use instead of, or together with, department."),
        timeOffType: filterText.optional().describe("Vacation time-off type name or id. Default: the enrolled vacation type, else a type named like 'vacation' or 'puhkus'."),
        onlyMissingFourteenDayBlock: z.boolean().optional().describe("Return only employees without a 14-day continuous block."),
      },
      annotations: READ_ONLY,
    },
    async (input) =>
      run(
        ctx,
        {
          tool: "bamboohr_vacation_overview",
          filters: {
            year: input.year,
            asOf: input.asOf,
            department: input.department,
            onlyMissingFourteenDayBlock: input.onlyMissingFourteenDayBlock,
          },
          employeeIds: input.employeeIds,
          count: (r: { employees: unknown[] }) => r.employees.length,
        },
        () => {
          requireFilter(
            Boolean(input.department?.trim() || input.employeeIds?.length),
            "bamboohr_vacation_overview requires a department or employeeIds; a company-wide overview is not allowed in one call. Ask per department."
          );
          return buildVacationOverview(api, input, {
            envVacationType,
            today: today(),
            maxEmployees: maxRecords(),
          });
        }
      )
  );
}
