import { addDays, daysInclusive, type ISODate } from "./dates";
import type { DirectoryEmployee, TimeOffBalance, TimeOffRequest, TimeOffType } from "./types";

export const FOURTEEN_DAYS = 14;
export const DEFAULT_VACATION_PATTERN = /vacation|annual leave|puhkus/i;

export interface DateRange {
  start: ISODate;
  end: ISODate;
}

export interface Block extends DateRange {
  days: number;
}

export interface OverviewRow {
  employeeId: number;
  name: string;
  department?: string;
  balance?: number;
  usedYearToDate?: number;
  plannedAfterAsOf: number;
  unplanned?: number;
  longestBlockDays: number;
  hasFourteenDayBlock: boolean;
  blocks: Block[];
  error?: string;
}

function findType(types: TimeOffType[], value: string): TimeOffType | undefined {
  const v = value.trim();
  if (/^\d+$/.test(v)) {
    const byId = types.find((t) => t.id === v);
    if (byId) return byId;
  }
  return types.find((t) => t.name.toLowerCase() === v.toLowerCase());
}

/** Every type whose name looks like vacation. Callers decide what to do with 0 or 2+ matches. */
export function matchDefaultVacationTypes(types: TimeOffType[]): TimeOffType[] {
  return types.filter((t) => DEFAULT_VACATION_PATTERN.test(t.name));
}

export function resolveVacationType(
  types: TimeOffType[],
  explicit?: string,
  fromEnv?: string
): TimeOffType | undefined {
  if (explicit) return findType(types, explicit);
  if (fromEnv) {
    const t = findType(types, fromEnv);
    if (t) return t;
  }
  // Name matching resolves only when it is unambiguous: with both "Vacation" and
  // "Unpaid vacation" in the list, guessing would silently report the wrong type.
  const matches = matchDefaultVacationTypes(types);
  return matches.length === 1 ? matches[0] : undefined;
}

export function selectVacationRequests(requests: TimeOffRequest[], typeId: string): TimeOffRequest[] {
  return requests.filter(
    (r) => r.typeId === typeId && (r.status === "approved" || r.status === "requested")
  );
}

export function clipToYear(range: DateRange, year: number): DateRange | undefined {
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;
  if (range.end < yStart || range.start > yEnd) return undefined;
  return {
    start: range.start < yStart ? yStart : range.start,
    end: range.end > yEnd ? yEnd : range.end,
  };
}

export function mergeBlocks(ranges: DateRange[]): Block[] {
  const sorted = [...ranges].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const merged: DateRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= addDays(last.end, 1)) {
      if (r.end > last.end) last.end = r.end;
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }
  return merged.map((m) => ({ ...m, days: daysInclusive(m.start, m.end) }));
}

export function plannedAfter(requests: TimeOffRequest[], asOf: ISODate): number {
  return requests.filter((r) => r.start > asOf).reduce((sum, r) => sum + r.amount, 0);
}

function displayName(e: DirectoryEmployee): string {
  if (e.displayName) return e.displayName;
  return [e.firstName, e.lastName].filter(Boolean).join(" ") || `Employee ${e.id}`;
}

export function buildOverviewRow(input: {
  employee: DirectoryEmployee;
  requests: TimeOffRequest[];
  balance?: TimeOffBalance;
  year: number;
  asOf: ISODate;
  error?: string;
}): OverviewRow {
  const { employee, requests, balance, year, asOf, error } = input;

  const clipped = requests
    .map((r) => clipToYear({ start: r.start, end: r.end }, year))
    .filter((r): r is DateRange => r !== undefined);
  const blocks = mergeBlocks(clipped);
  const longestBlockDays = blocks.reduce((max, b) => Math.max(max, b.days), 0);
  const plannedAfterAsOf = plannedAfter(requests, asOf);

  const row: OverviewRow = {
    employeeId: employee.id,
    name: displayName(employee),
    plannedAfterAsOf,
    longestBlockDays,
    hasFourteenDayBlock: longestBlockDays >= FOURTEEN_DAYS,
    blocks,
  };
  if (employee.department) row.department = employee.department;
  if (balance) {
    row.balance = balance.balance;
    row.usedYearToDate = balance.usedYearToDate;
    row.unplanned = balance.balance - plannedAfterAsOf;
  }
  if (error) row.error = error;
  return row;
}
