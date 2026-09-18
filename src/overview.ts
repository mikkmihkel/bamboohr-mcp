import {
  buildOverviewRow, matchDefaultVacationTypes, resolveVacationType, selectVacationRequests,
  type OverviewRow,
} from "./analysis";
import type { BambooHRApi } from "./bamboohr";
import { isISODate, todayISO, yearOf, type ISODate } from "./dates";
import type { TimeOffBalance, TimeOffType } from "./types";

export interface OverviewInput {
  year?: number;
  asOf?: ISODate;
  department?: string;
  timeOffType?: string;
  onlyMissingFourteenDayBlock?: boolean;
}

export interface VacationOverview {
  year: number;
  asOf: ISODate;
  vacationType: TimeOffType;
  employees: OverviewRow[];
  summary: { employees: number; missingFourteenDayBlock: number; errors: number };
}

export class VacationTypeNotFoundError extends Error {
  /** The candidates to choose from: the ambiguous matches, or every type when none matched. */
  available: TimeOffType[];
  constructor(requested: string | undefined, available: TimeOffType[], reason: "unmatched" | "ambiguous" = "unmatched") {
    const names = available.map((t) => `${t.name} (id ${t.id})`).join(", ");
    super(
      reason === "ambiguous"
        ? `Several time-off types look like vacation: ${names}. Set BAMBOOHR_VACATION_TYPE or pass timeOffType to choose one.`
        : requested
          ? `No time-off type matches "${requested}". Available types: ${names}`
          : `Could not identify the vacation time-off type automatically. Set BAMBOOHR_VACATION_TYPE or pass timeOffType. Available types: ${names}`
    );
    this.name = "VacationTypeNotFoundError";
    this.available = available;
  }
}

export function resolveOverviewDefaults(
  input: OverviewInput,
  today: ISODate = todayISO()
): { year: number; asOf: ISODate } {
  if (input.asOf !== undefined && !isISODate(input.asOf)) {
    throw new Error(`asOf must be a valid YYYY-MM-DD date, got "${input.asOf}"`);
  }
  const currentYear = yearOf(today);
  const year = input.year ?? (input.asOf ? yearOf(input.asOf) : currentYear);

  let asOf: ISODate;
  if (input.asOf) {
    asOf = input.asOf;
  } else if (year === currentYear) {
    asOf = today;
  } else if (year < currentYear) {
    asOf = `${year}-12-31`;
  } else {
    asOf = `${year}-01-01`;
  }

  if (yearOf(asOf) !== year) {
    throw new Error(`asOf (${asOf}) must fall inside year ${year}`);
  }
  return { year, asOf };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function buildVacationOverview(
  api: BambooHRApi,
  input: OverviewInput,
  opts: { envVacationType?: string; concurrency?: number; today?: ISODate } = {}
): Promise<VacationOverview> {
  const { year, asOf } = resolveOverviewDefaults(input, opts.today);
  const concurrency = opts.concurrency ?? 5;

  const { timeOffTypes } = await api.getTimeOffTypes();
  const vacationType = resolveVacationType(timeOffTypes, input.timeOffType, opts.envVacationType);
  if (!vacationType) {
    const requested = input.timeOffType ?? opts.envVacationType;
    const candidates = requested ? [] : matchDefaultVacationTypes(timeOffTypes);
    if (candidates.length > 1) throw new VacationTypeNotFoundError(undefined, candidates, "ambiguous");
    throw new VacationTypeNotFoundError(requested, timeOffTypes);
  }

  const directory = await api.getDirectory();
  const wanted = input.department?.trim().toLowerCase();
  const employees = wanted
    ? directory.filter((e) => e.department?.trim().toLowerCase() === wanted)
    : directory;

  const allRequests = await api.getTimeOffRequests({
    start: `${year}-01-01`,
    end: `${year}-12-31`,
    status: ["approved", "requested"],
    typeIds: [vacationType.id],
  });
  const vacationRequests = selectVacationRequests(allRequests, vacationType.id);
  const byEmployee = new Map<number, typeof vacationRequests>();
  for (const r of vacationRequests) {
    const list = byEmployee.get(r.employeeId) ?? [];
    list.push(r);
    byEmployee.set(r.employeeId, list);
  }

  const rows = await mapWithConcurrency(employees, concurrency, async (employee) => {
    let balance: TimeOffBalance | undefined;
    let error: string | undefined;
    try {
      const balances = await api.getBalances(employee.id, asOf);
      balance = balances.find((b) => b.timeOffTypeId === vacationType.id);
      if (!balance) error = `No "${vacationType.name}" balance found for this employee (no policy assigned?)`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    return buildOverviewRow({
      employee,
      requests: byEmployee.get(employee.id) ?? [],
      balance,
      year,
      asOf,
      error,
    });
  });

  const summary = {
    employees: rows.length,
    missingFourteenDayBlock: rows.filter((r) => !r.hasFourteenDayBlock).length,
    errors: rows.filter((r) => r.error).length,
  };

  const visible = input.onlyMissingFourteenDayBlock ? rows.filter((r) => !r.hasFourteenDayBlock) : rows;

  return { year, asOf, vacationType, employees: visible, summary };
}
