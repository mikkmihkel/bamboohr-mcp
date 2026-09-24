import { describe, expect, it, vi } from "vitest";
import type { BambooHRApi } from "../src/bamboohr";
import { buildVacationOverview, resolveOverviewDefaults, VacationTypeNotFoundError } from "../src/overview";
import { PolicyError } from "../src/policy";
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
    // The real API filters server-side when employeeId is given; the fake must too, otherwise a
    // per-employee fetch would look like it returned everyone's requests.
    getTimeOffRequests: vi.fn(async (q: { employeeId?: number }) =>
      [
        req(10, 1, "2026-07-06", "2026-07-19", 10),
        req(11, 1, "2026-10-05", "2026-10-09", 5, "requested"),
        req(12, 2, "2026-08-03", "2026-08-07", 5),
        req(13, 2, "2026-11-02", "2026-11-06", 5, "denied"),
      ].filter((r) => q.employeeId === undefined || r.employeeId === q.employeeId)
    ),
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
    const api = fakeApi({
      getTimeOffTypes: vi.fn(async () => ({
        timeOffTypes: [
          { id: "2", name: "Unpaid leave", units: "days" as const },
          { id: "78", name: "Vacation", units: "days" as const },
        ],
        defaultHours: [],
      })),
    });
    const out = await buildVacationOverview(api, {}, { today: TODAY, envVacationType: "Unpaid leave" });
    expect(out.vacationType.id).toBe("2");
  });

  it("refuses a health-related type as the vacation type, before reading the directory", async () => {
    // This report names every employee, their balance and every absence block: for sick leave
    // that is a health record, whoever asked for it.
    for (const requested of [{ timeOffType: "Sick" }, {}]) {
      const api = fakeApi();
      const err = await buildVacationOverview(api, requested, {
        today: TODAY,
        envVacationType: requested.timeOffType ? undefined : "Sick",
      }).catch((e) => e);
      expect(err).toBeInstanceOf(PolicyError);
      expect(err.code).toBe("tool_disabled");
      expect(err.message).toMatch(/health-related/);
      expect(api.getDirectory).not.toHaveBeenCalled();
    }
  });

  it("throws VacationTypeNotFoundError listing available types", async () => {
    const err = await buildVacationOverview(fakeApi(), { timeOffType: "Sabbatical" }, { today: TODAY }).catch((e) => e);
    expect(err).toBeInstanceOf(VacationTypeNotFoundError);
    expect(err.available.map((t: any) => t.name)).toEqual(["Vacation"]); // "Sick" is hidden
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

  it("narrows to employeeIds after the department filter", async () => {
    const api = fakeApi();
    const out = await buildVacationOverview(api, { employeeIds: [1, 2] }, { today: TODAY });
    expect(out.employees.map((e) => e.employeeId)).toEqual([1, 2]);
    expect(api.getBalances).toHaveBeenCalledTimes(2);
    expect(out.employees[0].plannedAfterAsOf).toBe(5);

    const both = await buildVacationOverview(fakeApi(), { department: "Engineering", employeeIds: [1, 2] }, { today: TODAY });
    expect(both.employees.map((e) => e.employeeId)).toEqual([1]);
  });

  it("refuses a group larger than maxEmployees before any balance call", async () => {
    const api = fakeApi();
    const err = await buildVacationOverview(api, {}, { today: TODAY, maxEmployees: 2 }).catch((e) => e);
    expect(err).toBeInstanceOf(PolicyError);
    expect(err.code).toBe("record_limit");
    expect(err.message).toMatch(/Result has 3 records, above the per-call limit of 2\. Choose a smaller department or pass employeeIds\./);
    expect(api.getBalances).not.toHaveBeenCalled();
    expect(api.getTimeOffRequests).not.toHaveBeenCalled();

    const ok = await buildVacationOverview(fakeApi(), { department: "Engineering" }, { today: TODAY, maxEmployees: 2 });
    expect(ok.employees).toHaveLength(2);
  });

  it("asks for the requests of each named employee instead of the whole company", async () => {
    // A company-wide request list would hand back the vacation of everyone else too.
    const api = fakeApi();
    await buildVacationOverview(api, { employeeIds: [1, 2] }, { today: TODAY });
    expect(api.getTimeOffRequests).toHaveBeenCalledTimes(2);
    for (const [q] of (api.getTimeOffRequests as any).mock.calls) {
      expect([1, 2]).toContain(q.employeeId);
      expect(q).toMatchObject({ start: "2026-01-01", end: "2026-12-31", typeIds: ["78"] });
    }
  });

  it("keeps one company-wide request call in department mode", async () => {
    // BambooHR has no server-side department filter for requests, so this stays a single call.
    const api = fakeApi();
    const out = await buildVacationOverview(api, { department: "Engineering" }, { today: TODAY });
    expect(api.getTimeOffRequests).toHaveBeenCalledTimes(1);
    expect((api.getTimeOffRequests as any).mock.calls[0][0].employeeId).toBeUndefined();
    expect(out.employees.find((e) => e.employeeId === 1)!.plannedAfterAsOf).toBe(5);
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
