import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EMPLOYEE_FIELDS } from "../src/fields";
import { ALLOWED_STANDARD_FIELDS } from "../src/policy";
import { connect, fakeApi, parseToolPayload, toolText } from "./helpers";

describe("bamboohr_get_employee", () => {
  it("defaults to the caller's own record, compacts values and reports missing fields", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const res = await client.callTool({
      name: "bamboohr_get_employee",
      arguments: { fields: ["firstName", "customShoeSize", "hireDate"] },
    });
    expect(api.getEmployee).toHaveBeenCalledWith(0, ["firstName", "customShoeSize", "hireDate"]);
    expect(parseToolPayload(res)).toEqual({
      id: 0,
      fields: { firstName: "Anna", customShoeSize: "42" },
      missingFields: ["hireDate"],
      excludedFields: [],
    });
  });

  it("uses the allow-listed default field set when none is given", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    await client.callTool({ name: "bamboohr_get_employee", arguments: { employeeId: 7 } });
    const fields = (api.getEmployee as any).mock.calls[0][1] as string[];
    expect(fields).toEqual([...DEFAULT_EMPLOYEE_FIELDS]);
    expect(fields).toContain("hireDate");
    expect(fields).toContain("status");
    for (const f of fields) expect(ALLOWED_STANDARD_FIELDS.has(f), f).toBe(true);
    expect(fields).not.toContain("dateOfBirth");
    expect(fields).not.toContain("gender");
  });

  it("refuses excluded fields without calling BambooHR", async () => {
    const api = fakeApi();
    const { client, audit } = await connect(api);
    for (const field of ["payRate", "dateOfBirth", "Pay rate", "17"]) {
      const res = await client.callTool({ name: "bamboohr_get_employee", arguments: { employeeId: 7, fields: [field] } });
      expect(res.isError, field).toBe(true);
      expect(toolText(res), field).toContain("excluded by policy");
    }
    expect(api.getEmployee).not.toHaveBeenCalled();
    expect(audit.entries.map((e) => e.outcome)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
    expect(audit.entries[0].error).toBe("PolicyError field_excluded");
  });

  it("accepts a custom field resolved through the metadata, by name or id", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const res = await client.callTool({ name: "bamboohr_get_employee", arguments: { employeeId: 7, fields: ["Shoe size"] } });
    expect(res.isError).toBeFalsy();
    // The canonical alias is what reaches BambooHR, whatever spelling was asked for.
    expect(api.getEmployee).toHaveBeenCalledWith(7, ["customShoeSize"]);
    expect(parseToolPayload(res).fields).toEqual({ firstName: "Anna", customShoeSize: "42" });
  });

  it("refuses a custom field whose name or alias is sensitive", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const res = await client.callTool({ name: "bamboohr_get_employee", arguments: { fields: ["customBonusScheme"] } });
    expect(res.isError).toBe(true);
    expect(api.getEmployee).not.toHaveBeenCalled();
  });
});

describe("custom-field allow-list", () => {
  it("refuses a custom field that is not on the configured allow-list", async () => {
    const api = fakeApi();
    const { client } = await connect(api, { settings: { allowedCustomFields: ["customOther"] } });
    const res = await client.callTool({
      name: "bamboohr_get_employee",
      arguments: { employeeId: 7, fields: ["customShoeSize"] },
    });
    expect(res.isError).toBe(true);
    expect(toolText(res)).toContain("custom-field allow-list");
    expect(api.getEmployee).not.toHaveBeenCalled();
  });

  it("allows a listed custom field and still allows standard fields", async () => {
    const api = fakeApi();
    const { client } = await connect(api, { settings: { allowedCustomFields: ["CustomShoeSize"] } });
    const res = await client.callTool({
      name: "bamboohr_get_employee",
      arguments: { employeeId: 7, fields: ["customShoeSize", "firstName"] },
    });
    expect(res.isError).toBeFalsy();
    expect(api.getEmployee).toHaveBeenCalledWith(7, ["customShoeSize", "firstName"]);
  });

  it("refuses every custom field when the allow-list is empty", async () => {
    const api = fakeApi();
    const { client } = await connect(api, { settings: { allowedCustomFields: [] } });
    const res = await client.callTool({
      name: "bamboohr_employee_report",
      arguments: { fields: ["customShoeSize"], department: "Engineering" },
    });
    expect(res.isError).toBe(true);
    expect(api.runCustomReport).not.toHaveBeenCalled();
  });

  it("refuses a custom field whose BambooHR type is sensitive, however it is named", async () => {
    const api = fakeApi({
      getFields: vi.fn(async () => [
        { id: "5000", name: "Extra info", alias: "customExtraInfo", type: "currency" },
      ]),
    });
    const { client } = await connect(api);
    const res = await client.callTool({
      name: "bamboohr_get_employee",
      arguments: { employeeId: 7, fields: ["customExtraInfo"] },
    });
    expect(res.isError).toBe(true);
    expect(toolText(res)).toContain("sensitive field type currency");
    expect(api.getEmployee).not.toHaveBeenCalled();
  });
});

describe("bamboohr_employee_report", () => {
  it("requires employeeIds or an organisational filter", async () => {
    const api = fakeApi();
    const { client, audit } = await connect(api);
    const res = await client.callTool({ name: "bamboohr_employee_report", arguments: { fields: ["customShoeSize"] } });
    expect(res.isError).toBe(true);
    expect(toolText(res)).toMatch(/requires employeeIds .*or a department, location or division filter/);
    expect(api.runCustomReport).not.toHaveBeenCalled();
    expect(audit.entries[0].error).toBe("PolicyError filter_required");
  });

  it("filters rows by department client-side and asks BambooHR for the filter column", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const res = await client.callTool({
      name: "bamboohr_employee_report",
      arguments: { fields: ["customShoeSize", "hireDate"], department: "engineering" },
    });
    expect((api.runCustomReport as any).mock.calls[0][0]).toEqual([
      "id", "displayName", "status", "customShoeSize", "hireDate", "department",
    ]);
    const body = parseToolPayload(res);
    expect(body.employees).toEqual([
      { id: 7, displayName: "Anna Tamm", status: "Active", department: "Engineering", location: "Tallinn", customShoeSize: "42" },
    ]);
    expect(body.missingFields).toEqual(["hireDate"]);
    expect(body.totalEmployees).toBe(3);
    expect(body.returnedEmployees).toBe(1);
    expect(body.excludedFields).toEqual([]);
  });

  it("keeps inactive rows when asked and rejects too many fields", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const res = await client.callTool({
      name: "bamboohr_employee_report",
      arguments: { fields: ["customShoeSize"], department: "Engineering", includeInactive: true },
    });
    expect(parseToolPayload(res).employees).toHaveLength(2);
    const tooMany = await client.callTool({
      name: "bamboohr_employee_report",
      arguments: { fields: Array.from({ length: 398 }, (_, i) => `f${i}`), department: "Engineering" },
    });
    expect(tooMany.isError).toBe(true);
    expect(api.runCustomReport).toHaveBeenCalledTimes(1);
  });

  it("refuses when more rows come back than the per-call limit allows", async () => {
    const api = fakeApi();
    const { client, audit } = await connect(api, { settings: { maxRecords: 1 } });
    const res = await client.callTool({
      name: "bamboohr_employee_report",
      arguments: { fields: ["customShoeSize"], department: "Engineering", includeInactive: true },
    });
    expect(res.isError).toBe(true);
    expect(toolText(res)).toMatch(/above the per-call limit of 1/);
    expect(toolText(res)).toMatch(/Narrow the filter/);
    expect(audit.entries[0].error).toBe("PolicyError record_limit");
  });

  it("refuses more employeeIds than the limit before calling BambooHR", async () => {
    const api = fakeApi();
    const { client } = await connect(api, { settings: { maxRecords: 2 } });
    const res = await client.callTool({
      name: "bamboohr_employee_report",
      arguments: { fields: ["customShoeSize"], employeeIds: [1, 2, 3] },
    });
    expect(res.isError).toBe(true);
    expect(api.runCustomReport).not.toHaveBeenCalled();
  });

  it("refuses excluded fields", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const res = await client.callTool({
      name: "bamboohr_employee_report",
      arguments: { fields: ["payRate"], department: "Engineering" },
    });
    expect(res.isError).toBe(true);
    expect(toolText(res)).toContain("excluded by policy");
    expect(api.runCustomReport).not.toHaveBeenCalled();
  });

  it("errors when none of the requested fields came back", async () => {
    const api = fakeApi();
    (api.runCustomReport as any).mockResolvedValueOnce({ fields: [{ id: "id", type: "int", name: "id" }], employees: [] });
    const { client } = await connect(api);
    const res = await client.callTool({
      name: "bamboohr_employee_report",
      arguments: { fields: ["customShoeSize"], department: "Engineering" },
    });
    expect(res.isError).toBe(true);
    expect(toolText(res)).toMatch(/access level|field names/);
  });
});

describe("bamboohr_table_rows", () => {
  it("requires an employeeId", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const outcome = await client
      .callTool({ name: "bamboohr_table_rows", arguments: { table: "customEquipment" } })
      .then((r) => ({ kind: "result" as const, r }), (e) => ({ kind: "thrown" as const, e }));
    if (outcome.kind === "result") expect(outcome.r.isError).toBe(true);
    else expect(String(outcome.e.message)).toMatch(/Invalid arguments|employeeId/);
    expect(api.getTableRows).not.toHaveBeenCalled();
  });

  it("reads one employee's rows and validates the alias against metadata", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const ok = await client.callTool({ name: "bamboohr_table_rows", arguments: { table: "customEquipment", employeeId: 7 } });
    expect(api.getTableRows).toHaveBeenCalledWith("customEquipment", 7);
    expect(parseToolPayload(ok)).toEqual({ table: "customEquipment", rows: [{ id: 55, employeeId: 7, customItem: "Laptop" }] });
    const bad = await client.callTool({ name: "bamboohr_table_rows", arguments: { table: "customNope", employeeId: 7 } });
    expect(bad.isError).toBe(true);
    expect(toolText(bad)).toMatch(/jobInfo/);
    expect(api.getTables).toHaveBeenCalledTimes(1);
  });

  it("drops columns of a blocked type or name from the rows and the table list", async () => {
    const api = fakeApi({
      getTables: vi.fn(async () => [
        { alias: "customEquipment", fields: [
          { id: "1", name: "Item", alias: "customItem", type: "text" },
          { id: "2", name: "Value", alias: "customValue", type: "currency" },
        ] },
      ]),
      getTableRows: vi.fn(async () => [{ id: 55, employeeId: 7, customItem: "Laptop", customValue: "1200 EUR" }]),
    });
    const { client } = await connect(api);
    const rows = await client.callTool({ name: "bamboohr_table_rows", arguments: { table: "customEquipment", employeeId: 7 } });
    expect(parseToolPayload(rows)).toEqual({ table: "customEquipment", rows: [{ id: 55, employeeId: 7, customItem: "Laptop" }] });
    const list = await client.callTool({ name: "bamboohr_list_tables", arguments: {} });
    expect(JSON.stringify(parseToolPayload(list))).not.toContain("customValue");
  });

  it("refuses excluded tables before any metadata lookup", async () => {
    const api = fakeApi({ getTables: vi.fn(async () => { throw new Error("metadata unavailable"); }) });
    const { client, audit } = await connect(api);
    for (const table of ["compensation", "customBonus", "bankAccounts", "directDeposit", "earnings", "employeePassports", "employeeCovidTests"]) {
      const res = await client.callTool({ name: "bamboohr_table_rows", arguments: { table, employeeId: 7 } });
      expect(res.isError, table).toBe(true);
      expect(toolText(res), table).toContain("excluded by policy");
    }
    expect(api.getTables).not.toHaveBeenCalled();
    expect(api.getTableRows).not.toHaveBeenCalled();
    expect(audit.entries.every((e) => e.outcome === "rejected" && e.error === "PolicyError table_excluded")).toBe(true);
  });
});

describe("bamboohr_changed_employees", () => {
  it("expands a bare date and audits only the filter", async () => {
    const api = fakeApi();
    const { client, audit } = await connect(api);
    await client.callTool({ name: "bamboohr_changed_employees", arguments: { since: "2026-09-01", type: "updated" } });
    expect(api.getChangedEmployees).toHaveBeenCalledWith("2026-09-01T00:00:00+00:00", "updated");
    expect(audit.entries[0]).toMatchObject({ outcome: "ok", filters: { since: "2026-09-01", type: "updated" } });
  });

  it("refuses more changed employees than the per-call limit", async () => {
    // An old `since` otherwise returns the whole company as one list of ids.
    const api = fakeApi({
      getChangedEmployees: vi.fn(async () => ({
        latest: "2026-09-14",
        employees: Array.from({ length: 3 }, (_, i) => ({
          id: i,
          action: "Updated" as const,
          lastChanged: "2026-09-01T00:00:00+00:00",
        })),
      })),
    });
    const { client, audit } = await connect(api, { settings: { maxRecords: 2 } });
    const res = await client.callTool({ name: "bamboohr_changed_employees", arguments: { since: "2020-01-01" } });
    expect(res.isError).toBe(true);
    expect(toolText(res)).toMatch(/above the per-call limit of 2\. Use a more recent since or a change type\./);
    expect(audit.entries[0].error).toBe("PolicyError record_limit");
  });

  it.each(["last tuesday", "2026-09-01; DROP", "01/09/2026", "2026-9-1"])(
    "rejects %s as a since value without calling the API",
    async (since) => {
      const api = fakeApi();
      const { client } = await connect(api);
      const outcome = await client
        .callTool({ name: "bamboohr_changed_employees", arguments: { since } })
        .then((r) => ({ kind: "result" as const, r }), (e) => ({ kind: "thrown" as const, e }));
      if (outcome.kind === "result") expect(outcome.r.isError).toBe(true);
      else expect(String(outcome.e.message)).toMatch(/Invalid arguments|ISO 8601/);
      expect(api.getChangedEmployees).not.toHaveBeenCalled();
    }
  );

  it("accepts a full ISO date-time", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    await client.callTool({
      name: "bamboohr_changed_employees",
      arguments: { since: "2026-09-01T00:00:00+00:00" },
    });
    expect(api.getChangedEmployees).toHaveBeenCalledWith("2026-09-01T00:00:00+00:00", undefined);
  });
});

describe("filter and audit hygiene", () => {
  it("rejects a whitespace-only organisational filter", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const outcome = await client
      .callTool({ name: "bamboohr_employee_report", arguments: { fields: ["customShoeSize"], department: "   " } })
      .then((r) => ({ kind: "result" as const, r }), (e) => ({ kind: "thrown" as const, e }));
    if (outcome.kind === "result") expect(outcome.r.isError).toBe(true);
    else expect(String(outcome.e.message)).toMatch(/Invalid arguments|too small/);
    expect(api.runCustomReport).not.toHaveBeenCalled();
  });

  it("trims a padded filter before comparing rows", async () => {
    const api = fakeApi();
    const { client, audit } = await connect(api);
    const res = await client.callTool({
      name: "bamboohr_employee_report",
      arguments: { fields: ["customShoeSize"], department: "  Engineering  " },
    });
    expect(parseToolPayload(res).employees).toHaveLength(1);
    expect(audit.entries[0].filters).toEqual({ department: "Engineering" });
  });

  it("rejects a table alias that is not a BambooHR identifier", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const outcome = await client
      .callTool({ name: "bamboohr_table_rows", arguments: { table: "jobInfo; rm -rf /", employeeId: 7 } })
      .then((r) => ({ kind: "result" as const, r }), (e) => ({ kind: "thrown" as const, e }));
    if (outcome.kind === "result") expect(outcome.r.isError).toBe(true);
    else expect(String(outcome.e.message)).toMatch(/Invalid arguments|table alias/);
    expect(api.getTableRows).not.toHaveBeenCalled();
  });

  it("truncates long filter values and field names in the audit log", async () => {
    const api = fakeApi();
    const { client, audit } = await connect(api);
    const longAlias = `custom${"X".repeat(200)}`;
    await client.callTool({
      name: "bamboohr_employee_report",
      arguments: { fields: [longAlias], department: "E".repeat(200) },
    });
    const entry = audit.entries[0];
    expect((entry.filters!.department as string).length).toBeLessThanOrEqual(65);
    expect(entry.fields![0].length).toBeLessThanOrEqual(65);
  });
});
