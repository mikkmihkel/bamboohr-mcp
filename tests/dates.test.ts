import { describe, expect, it } from "vitest";
import { addDays, daysInclusive, isISODate, todayISO, yearOf } from "../src/dates";

describe("dates", () => {
  it("validates YYYY-MM-DD", () => {
    expect(isISODate("2026-09-14")).toBe(true);
    expect(isISODate("2026-9-14")).toBe(false);
    expect(isISODate("2026-13-01")).toBe(false);
    expect(isISODate("2026-02-30")).toBe(false);
    expect(isISODate("not a date")).toBe(false);
  });

  it("formats today from a Date using the local calendar", () => {
    expect(todayISO(new Date(2026, 8, 14, 23, 30))).toBe("2026-09-14");
    expect(todayISO(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-09-14", 14)).toBe("2026-09-28");
  });

  it("counts inclusive days", () => {
    expect(daysInclusive("2026-07-06", "2026-07-06")).toBe(1);
    expect(daysInclusive("2026-07-06", "2026-07-19")).toBe(14);
    expect(daysInclusive("2026-03-28", "2026-04-02")).toBe(6); // crosses DST in Europe
  });

  it("extracts the year", () => {
    expect(yearOf("2026-09-14")).toBe(2026);
  });
});
