import { describe, expect, it } from "vitest";
import {
  buildOverviewRow, clipToYear, matchDefaultVacationTypes, mergeBlocks, plannedAfter, resolveVacationType,
  selectVacationRequests,
} from "../src/analysis";
import type { DirectoryEmployee, TimeOffBalance, TimeOffRequest, TimeOffType } from "../src/types";

const types: TimeOffType[] = [
  { id: "1", name: "Sick", units: "days" },
  { id: "78", name: "Põhipuhkus (Vacation)", units: "days" },
  { id: "90", name: "Unpaid leave", units: "days" },
];

function req(p: Partial<TimeOffRequest>): TimeOffRequest {
  return {
    id: 1, employeeId: 7, employeeName: "Anna Tamm", start: "2026-07-06", end: "2026-07-19", created: "2026-05-01",
    status: "approved", typeId: "78", typeName: "Vacation", amount: 10, unit: "days", ...p,
  };
}

describe("resolveVacationType", () => {
  it("prefers the explicit argument, by id or by case-insensitive name", () => {
    expect(resolveVacationType(types, "90")?.id).toBe("90");
    expect(resolveVacationType(types, "sick")?.id).toBe("1");
  });
  it("falls back to the env value, then to name pattern matching", () => {
    expect(resolveVacationType(types, undefined, "Unpaid leave")?.id).toBe("90");
    expect(resolveVacationType(types)?.id).toBe("78");
  });
  it("returns undefined when nothing matches", () => {
    expect(resolveVacationType(types, "Sabbatical")).toBeUndefined();
    expect(resolveVacationType([{ id: "1", name: "Sick", units: "days" }])).toBeUndefined();
  });
  it("returns undefined rather than guessing when several types match the pattern", () => {
    const ambiguous: TimeOffType[] = [
      { id: "1", name: "Sick", units: "days" },
      { id: "78", name: "Vacation", units: "days" },
      { id: "79", name: "Unpaid vacation", units: "days" },
    ];
    expect(resolveVacationType(ambiguous)).toBeUndefined();
    expect(resolveVacationType(ambiguous, "78")?.id).toBe("78");
    expect(resolveVacationType(ambiguous, undefined, "Vacation")?.id).toBe("78");
  });
});

describe("matchDefaultVacationTypes", () => {
  it("returns every type whose name matches the default pattern", () => {
    expect(matchDefaultVacationTypes(types).map((t) => t.id)).toEqual(["78"]);
    expect(
      matchDefaultVacationTypes([
        { id: "78", name: "Vacation", units: "days" },
        { id: "79", name: "Unpaid vacation", units: "days" },
        { id: "1", name: "Sick", units: "days" },
      ]).map((t) => t.id)
    ).toEqual(["78", "79"]);
    expect(matchDefaultVacationTypes([{ id: "1", name: "Sick", units: "days" }])).toEqual([]);
  });
});

describe("selectVacationRequests", () => {
  it("keeps approved and requested requests of the given type only", () => {
    const rs = [
      req({ id: 1, status: "approved" }),
      req({ id: 2, status: "requested" }),
      req({ id: 3, status: "denied" }),
      req({ id: 4, status: "canceled" }),
      req({ id: 5, status: "superceded" }),
      req({ id: 6, status: "approved", typeId: "1" }),
    ];
    expect(selectVacationRequests(rs, "78").map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("clipToYear", () => {
  it("clips ranges crossing the year boundary and drops ranges outside", () => {
    expect(clipToYear({ start: "2025-12-27", end: "2026-01-04" }, 2026)).toEqual({ start: "2026-01-01", end: "2026-01-04" });
    expect(clipToYear({ start: "2026-12-28", end: "2027-01-10" }, 2026)).toEqual({ start: "2026-12-28", end: "2026-12-31" });
    expect(clipToYear({ start: "2026-07-06", end: "2026-07-19" }, 2026)).toEqual({ start: "2026-07-06", end: "2026-07-19" });
    expect(clipToYear({ start: "2025-07-06", end: "2025-07-19" }, 2026)).toBeUndefined();
  });
});

describe("mergeBlocks", () => {
  it("returns an empty list for no ranges", () => {
    expect(mergeBlocks([])).toEqual([]);
  });
  it("computes inclusive day counts for a single range", () => {
    expect(mergeBlocks([{ start: "2026-07-06", end: "2026-07-19" }])).toEqual([{ start: "2026-07-06", end: "2026-07-19", days: 14 }]);
  });
  it("merges back-to-back ranges (next starts the day after previous ends)", () => {
    expect(mergeBlocks([
      { start: "2026-07-13", end: "2026-07-19" },
      { start: "2026-07-06", end: "2026-07-12" },
    ])).toEqual([{ start: "2026-07-06", end: "2026-07-19", days: 14 }]);
  });
  it("merges overlapping ranges", () => {
    expect(mergeBlocks([
      { start: "2026-07-06", end: "2026-07-15" },
      { start: "2026-07-10", end: "2026-07-19" },
    ])).toEqual([{ start: "2026-07-06", end: "2026-07-19", days: 14 }]);
  });
  it("keeps ranges separated by a gap apart, sorted by start", () => {
    expect(mergeBlocks([
      { start: "2026-08-03", end: "2026-08-07" },
      { start: "2026-07-06", end: "2026-07-10" },
    ])).toEqual([
      { start: "2026-07-06", end: "2026-07-10", days: 5 },
      { start: "2026-08-03", end: "2026-08-07", days: 5 },
    ]);
  });
});

describe("plannedAfter", () => {
  it("sums amounts of requests starting strictly after asOf", () => {
    const rs = [
      req({ id: 1, start: "2026-10-05", end: "2026-10-09", amount: 5 }),
      req({ id: 2, start: "2026-09-14", end: "2026-09-16", amount: 3 }), // starts on asOf: excluded
      req({ id: 3, start: "2026-09-10", end: "2026-09-18", amount: 7 }), // spans asOf: excluded
      req({ id: 4, start: "2026-06-01", end: "2026-06-05", amount: 5 }), // past: excluded
    ];
    expect(plannedAfter(rs, "2026-09-14")).toBe(5);
  });
});

describe("buildOverviewRow", () => {
  const employee: DirectoryEmployee = { id: 7, displayName: "Anna Tamm", department: "Engineering" };
  const balance: TimeOffBalance = {
    timeOffTypeId: "78", name: "Vacation", units: "days", balance: 18, usedYearToDate: 10, policyType: "accruing", asOf: "2026-09-14",
  };

  it("computes planned, unplanned, blocks and the 14-day flag", () => {
    const row = buildOverviewRow({
      employee, balance, year: 2026, asOf: "2026-09-14",
      requests: [
        req({ id: 1, start: "2026-07-06", end: "2026-07-14", amount: 7 }),
        req({ id: 2, start: "2026-10-05", end: "2026-10-09", amount: 5 }),
      ],
    });
    expect(row).toEqual({
      employeeId: 7, name: "Anna Tamm", department: "Engineering",
      balance: 18, usedYearToDate: 10, plannedAfterAsOf: 5, unplanned: 13,
      longestBlockDays: 9, hasFourteenDayBlock: false,
      blocks: [
        { start: "2026-07-06", end: "2026-07-14", days: 9 },
        { start: "2026-10-05", end: "2026-10-09", days: 5 },
      ],
    });
  });

  it("flags a 14-day block built from two adjacent requests", () => {
    const row = buildOverviewRow({
      employee, balance, year: 2026, asOf: "2026-09-14",
      requests: [
        req({ id: 1, start: "2026-07-06", end: "2026-07-12", amount: 5 }),
        req({ id: 2, start: "2026-07-13", end: "2026-07-19", amount: 5 }),
      ],
    });
    expect(row.hasFourteenDayBlock).toBe(true);
    expect(row.longestBlockDays).toBe(14);
  });

  it("does not count a 13-day block", () => {
    const row = buildOverviewRow({
      employee, balance, year: 2026, asOf: "2026-09-14",
      requests: [req({ id: 1, start: "2026-07-06", end: "2026-07-18", amount: 9 })],
    });
    expect(row.hasFourteenDayBlock).toBe(false);
    expect(row.longestBlockDays).toBe(13);
  });

  it("clips a request crossing the year boundary before measuring", () => {
    const row = buildOverviewRow({
      employee, balance, year: 2026, asOf: "2026-09-14",
      requests: [req({ id: 1, start: "2026-12-22", end: "2027-01-10", amount: 14 })],
    });
    expect(row.blocks).toEqual([{ start: "2026-12-22", end: "2026-12-31", days: 10 }]);
    expect(row.plannedAfterAsOf).toBe(14);
  });

  it("reports negative unplanned when overbooked", () => {
    const row = buildOverviewRow({
      employee, balance: { ...balance, balance: 3 }, year: 2026, asOf: "2026-09-14",
      requests: [req({ id: 1, start: "2026-10-05", end: "2026-10-09", amount: 5 })],
    });
    expect(row.unplanned).toBe(-2);
  });

  it("falls back to first and last name when displayName is missing", () => {
    const row = buildOverviewRow({
      employee: { id: 7, firstName: "Anna", lastName: "Tamm" }, balance, year: 2026, asOf: "2026-09-14", requests: [],
    });
    expect(row.name).toBe("Anna Tamm");
  });

  it("carries an error and omits balance fields when the balance failed", () => {
    const row = buildOverviewRow({
      employee, year: 2026, asOf: "2026-09-14", requests: [], error: "BambooHR returned 403 for /employees/7/time_off/calculator",
    });
    expect(row.error).toMatch(/403/);
    expect(row.balance).toBeUndefined();
    expect(row.unplanned).toBeUndefined();
    expect(row.plannedAfterAsOf).toBe(0);
    expect(row.hasFourteenDayBlock).toBe(false);
  });
});
