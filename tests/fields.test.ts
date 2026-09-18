import { describe, expect, it } from "vitest";
import { compact, mergeFieldOptions, missingFields, searchFields, DEFAULT_EMPLOYEE_FIELDS, REPORT_ALWAYS_FIELDS } from "../src/fields";
import type { FieldMeta, ListFieldMeta } from "../src/types";

const fields: FieldMeta[] = [
  { id: "1", name: "First name", alias: "firstName", type: "text" },
  { id: "4", name: "Department", alias: "department", type: "list" },
  { id: "4471", name: "Shoe size", alias: "customShoeSize", type: "list" },
  { id: "9", name: "Old field", type: "text", deprecated: true },
];

const lists: ListFieldMeta[] = [
  { listId: "3", fieldId: "4", alias: "department", name: "Department", manageable: true, multiple: false,
    options: [{ id: "45", name: "Engineering", archived: false }, { id: "46", name: "Legacy", archived: true }] },
  { listId: "8", fieldId: "4471", alias: "customShoeSize", name: "Shoe size", manageable: true, multiple: false,
    options: [{ id: "90", name: "42", archived: false }] },
];

describe("compact", () => {
  it("drops null, undefined and empty strings and stringifies the rest", () => {
    expect(compact({ a: "x", b: "", c: null, d: undefined, e: 0, f: false })).toEqual({ a: "x", e: "0", f: "false" });
  });
});

describe("missingFields", () => {
  it("lists requested keys that are absent or empty, in request order", () => {
    expect(missingFields(["firstName", "shoeSize", "hireDate"], { firstName: "Anna", shoeSize: "" })).toEqual(["shoeSize", "hireDate"]);
  });
});

describe("mergeFieldOptions", () => {
  it("attaches options by fieldId, including archived ones, and leaves other fields untouched", () => {
    const merged = mergeFieldOptions(fields, lists);
    expect(merged[0]).toEqual(fields[0]);
    expect(merged[1].options).toEqual([{ id: "45", name: "Engineering", archived: false }, { id: "46", name: "Legacy", archived: true }]);
    expect(merged[2].options).toEqual([{ id: "90", name: "42", archived: false }]);
  });
});

describe("searchFields", () => {
  it("matches name or alias case-insensitively", () => {
    expect(searchFields(fields, "shoe").map((f) => f.id)).toEqual(["4471"]);
    expect(searchFields(fields, "DEPART").map((f) => f.id)).toEqual(["4"]);
  });
  it("returns everything for an empty search", () => {
    expect(searchFields(fields, undefined)).toHaveLength(4);
    expect(searchFields(fields, "  ")).toHaveLength(4);
  });
});

describe("constants", () => {
  it("default fields include hire date and status, and the report always asks for id, displayName, status", () => {
    expect(DEFAULT_EMPLOYEE_FIELDS).toContain("hireDate");
    expect(DEFAULT_EMPLOYEE_FIELDS).toContain("status");
    expect(REPORT_ALWAYS_FIELDS).toEqual(["id", "displayName", "status"]);
  });
});
