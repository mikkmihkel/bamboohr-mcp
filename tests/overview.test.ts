import { describe, expect, it, vi } from "vitest";
import type { BambooHRApi } from "../src/bamboohr";
import { buildVacationOverview, resolveOverviewDefaults, VacationTypeNotFoundError } from "../src/overview";
import type { TimeOffBalance, TimeOffRequest } from "../src/types";

const TODAY = "2026-09-14";

function balance(employeeId: number, bal: number): TimeOffBalance[] {
  return [
    { timeOffTypeId: "1", name: "Sick", units: "days", balance: 99, usedYearToDate: 0, policyType: "accruing", asOf: TODAY },
    { timeOffTypeId: "78", name: "Vacation", units: "days", balance: bal, usedYearToDate: 28 - bal, policyType: "accruing", asOf: TODAY },
  ];
}

function req(id: number, employeeId: number, start: string, end: string, amount: number, status: TimeOffRequest["status"] = "approved"): TimeOffRequest {
  return { id, employeeId, employeeName: `E${employeeId}`, start, end, created: "2026-01-01", status, typeId: "78", typeName: "Vacation", amount, unit: "days" };
}

function fakeApi(overrides: Partial<BambooHRApi> = {}): BambooHRApi {
  return {
    getWhosOut: vi.fn(async () => []),
    getDirectory: vi.fn(async () => [
      { id: 1, displayName: "Anna Tamm", department: "Engineering" },
      { id: 2, displayName: "Mart Mets", department: "Sales" },
      { id: 3, displayName: "Kati Kask", department: "Engineering" },
    ]),
    getTimeOffTypes: vi.fn(async () => ({
      timeOffTypes: [{ id: "1", name: "Sick", units: "days" as const }, { id: "78", name: "Vacation", units: "days" as const }],
      defaultHours: [],
    })),
    getBalances: vi.fn(async (employeeId: number) => {
      if (employeeId === 3) throw new Error("BambooHR returned 403 for /employees/3/time_off/calculator");
      return balance(employeeId, employeeId === 1 ? 18 : 5);
    }),
    getTimeOffRequests: vi.fn(async () => [
      req(10, 1, "2026-07-06", "2026-07-19", 10),
      req(11, 1, "2026-10-05", "2026-10-09", 5, "requested"),
      req(12, 2, "2026-08-03", "2026-08-07", 5),
      req(13, 2, "2026-11-02", "2026-11-06", 5, "denied"),
    ]),
    ...overrides,
  };
}

describe("resolveOverviewDefaults", () => {
  it("defaults to the current year and today", () => {
    expect(resolveOverviewDefaults({}, TODAY)).toEqual({ year: 2026, asOf: TODAY });
  });
  it("uses Dec 31 for a past year and Jan 1 for a future year when asOf is omitted", () => {
    expect(resolveOverviewDefaults({ year: 2025 }, TODAY)).toEqual({ year: 2025, asOf: "2025-12-31" });
    expect(resolveOverviewDefaults({ year: 2027 }, TODAY)).toEqual({ year: 2027, asOf: "2027-01-01" });
  });
  it("derives the year from asOf when only asOf is given", () => {
    expect(resolveOverviewDefaults({ asOf: "2025-06-30" }, TODAY)).toEqual({ year: 2025, asOf: "2025-06-30" });
  });
  it("rejects asOf outside the year and invalid dates", () => {
    expect(() => resolveOverviewDefaults({ year: 2026, asOf: "2025-12-31" }, TODAY)).toThrow(/inside/);
    expect(() => resolveOverviewDefaults({ asOf: "2026-02-30" }, TODAY)).toThrow(/YYYY-MM-DD/);
  });
});

describe("buildVacationOverview", () => {
  it("assembles rows, summary and vacation type", async () => {
    const api = fakeApi();
    const out = await buildVacationOverview(api, {}, { today: TODAY });

    expect(out.year).toBe(2026);
    expect(out.asOf).toBe(TODAY);
    expect(out.vacationType).toEqual({ id: "78", name: "Vacation", units: "days" });
    expect(api.getTimeOffRequests).toHaveBeenCalledWith({
      start: "2026-01-01", end: "2026-12-31", status: ["approved", "requested"], typeIds: ["78"],
    });
    expect(api.getBalances).toHaveBeenCalledTimes(3);
    expect(api.getBalances).toHaveBeenCalledWith(1, TODAY);

    const anna = out.employees.find((e) => e.employeeId === 1)!;
    expect(anna).toMatchObject({ balance: 18, usedYearToDate: 10, plannedAfterAsOf: 5, unplanned: 13, hasFourteenDayBlock: true, longestBlockDays: 14 });

    const mart = out.employees.find((e) => e.employeeId === 2)!;
    expect(mart).toMatchObject({ balance: 5, plannedAfterAsOf: 0, unplanned: 5, hasFourteenDayBlock: false, longestBlockDays: 5 });

    const kati = out.employees.find((e) => e.employeeId === 3)!;
    expect(kati.error).toMatch(/403/);
    expect(kati.balance).toBeUndefined();

    expect(out.summary).toEqual({ employees: 3, missingFourteenDayBlock: 2, errors: 1 });
  });

  it("filters by department case-insensitively", async () => {
    const out = await buildVacationOverview(fakeApi(), { department: "engineering" }, { today: TODAY });
    expect(out.employees.map((e) => e.employeeId).sort()).toEqual([1, 3]);
  });

  it("returns only employees missing a 14-day block when asked", async () => {
    const out = await buildVacationOverview(fakeApi(), { onlyMissingFourteenDayBlock: true }, { today: TODAY });
    expect(out.employees.map((e) => e.employeeId).sort()).toEqual([2, 3]);
    expect(out.summary.employees).toBe(3);
  });

  it("uses the env vacation type when no argument is given", async () => {
    const out = await buildVacationOverview(fakeApi(), {}, { today: TODAY, envVacationType: "Sick" });
    expect(out.vacationType.id).toBe("1");
  });

  it("throws VacationTypeNotFoundError listing available types", async () => {
    const err = await buildVacationOverview(fakeApi(), { timeOffType: "Sabbatical" }, { today: TODAY }).catch((e) => e);
    expect(err).toBeInstanceOf(VacationTypeNotFoundError);
    expect(err.available.map((t: any) => t.name)).toEqual(["Sick", "Vacation"]);
  });

  it("refuses to guess when several types match the default vacation pattern", async () => {
    const api = fakeApi({
      getTimeOffTypes: vi.fn(async () => ({
        timeOffTypes: [
          { id: "78", name: "Vacation", units: "days" as const },
          { id: "79", name: "Unpaid vacation", units: "days" as const },
        ],
        defaultHours: [],
      })),
    });
    const err = await buildVacationOverview(api, {}, { today: TODAY }).catch((e) => e);
    expect(err).toBeInstanceOf(VacationTypeNotFoundError);
    expect(err.available).toHaveLength(2);
    expect(err.available.map((t: any) => t.name)).toEqual(["Vacation", "Unpaid vacation"]);
    expect(err.message).toMatch(/Vacation/);
    expect(err.message).toMatch(/Unpaid vacation/);
    expect(err.message).toMatch(/BAMBOOHR_VACATION_TYPE/);
    expect(api.getDirectory).not.toHaveBeenCalled();
  });

  it("records an error row when the employee has no balance for the vacation type", async () => {
    const api = fakeApi({
      getDirectory: vi.fn(async () => [{ id: 4, displayName: "Peeter Puu" }]),
      getBalances: vi.fn(async () => [
        { timeOffTypeId: "1", name: "Sick", units: "days", balance: 99, usedYearToDate: 0, policyType: "accruing", asOf: TODAY },
      ]),
      getTimeOffRequests: vi.fn(async () => []),
    });
    const out = await buildVacationOverview(api, {}, { today: TODAY });
    const row = out.employees[0];
    expect(row.error).toMatch(/Vacation/);
    expect(row.balance).toBeUndefined();
    expect(row.usedYearToDate).toBeUndefined();
    expect(row.unplanned).toBeUndefined();
    expect(out.summary.errors).toBe(1);
  });

  it("limits concurrent balance calls", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const api = fakeApi({
      getDirectory: vi.fn(async () => Array.from({ length: 12 }, (_, i) => ({ id: i + 1, displayName: `E${i + 1}` }))),
      getBalances: vi.fn(async (id: number) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return balance(id, 10);
      }),
      getTimeOffRequests: vi.fn(async () => []),
    });
    await buildVacationOverview(api, {}, { today: TODAY, concurrency: 3 });
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(api.getBalances).toHaveBeenCalledTimes(12);
  });
});
