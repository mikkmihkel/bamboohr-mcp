import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import type { BambooHRApi } from "../src/bamboohr";
import { createServer } from "../src/server";

const TODAY = "2026-09-14";

function fakeApi(): BambooHRApi {
  return {
    getWhosOut: vi.fn(async (start: string, end: string) => [
      { id: 1, type: "timeOff" as const, employeeId: 7, name: "Anna Tamm", start, end },
    ]),
    getDirectory: vi.fn(async () => [{ id: 7, displayName: "Anna Tamm", department: "Engineering" }]),
    getTimeOffTypes: vi.fn(async () => ({ timeOffTypes: [{ id: "78", name: "Vacation", units: "days" as const }], defaultHours: [] })),
    getBalances: vi.fn(async () => [
      { timeOffTypeId: "78", name: "Vacation", units: "days", balance: 18, usedYearToDate: 10, policyType: "accruing", asOf: TODAY },
    ]),
    getTimeOffRequests: vi.fn(async () => []),
    getFields: vi.fn(async () => [
      { id: "1", name: "First name", alias: "firstName", type: "text" },
      { id: "4471", name: "Shoe size", alias: "customShoeSize", type: "list" },
    ]),
    getListFields: vi.fn(async () => [
      { listId: "8", fieldId: "4471", alias: "customShoeSize", name: "Shoe size", manageable: true, multiple: false, options: [{ id: "90", name: "42", archived: false }] },
    ]),
    getTables: vi.fn(async () => [{ alias: "jobInfo", fields: [] }, { alias: "customEquipment", fields: [] }]),
    getHolidays: vi.fn(async () => []),
    getUsers: vi.fn(async () => []),
    getEmployee: vi.fn(async (id: number, fields: string[]) => ({ id, values: { id: String(id), firstName: "Anna", customShoeSize: "42", hireDate: "" } })),
    runCustomReport: vi.fn(async (fields: string[]) => ({
      fields: fields.filter((f) => f !== "hireDate").map((f) => ({ id: f, type: "text", name: f })),
      employees: [
        { id: 7, displayName: "Anna Tamm", status: "Active", customShoeSize: "42" },
        { id: 8, displayName: "Old Hand", status: "Inactive", customShoeSize: "44" },
      ],
    })),
    getTableRows: vi.fn(async () => [{ id: 55, employeeId: 7, customItem: "Laptop" }]),
    getChangedEmployees: vi.fn(async () => ({ latest: "", employees: [] })),
    getTrainingTypes: vi.fn(async () => [{ id: 3, name: "First aid", required: false, renewable: true, frequencyMonths: 24 }]),
    getTrainingCategories: vi.fn(async () => [{ id: 1, name: "Safety" }]),
    getTrainingRecords: vi.fn(async () => [{ id: 21, trainingTypeId: 3, completed: "2026-03-01" }]),
    getDependents: vi.fn(async () => []),
    getEmployeeFiles: vi.fn(async () => []),
  };
}

async function connect(api: BambooHRApi) {
  const server = createServer(api, { today: () => TODAY });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return { client, server };
}

describe("MCP server", () => {
  it("exposes exactly the read-only tools", async () => {
    const { client } = await connect(fakeApi());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "bamboohr_changed_employees",
      "bamboohr_company_holidays",
      "bamboohr_employee_dependents",
      "bamboohr_employee_files",
      "bamboohr_employee_report",
      "bamboohr_get_employee",
      "bamboohr_list_employees",
      "bamboohr_list_fields",
      "bamboohr_list_tables",
      "bamboohr_list_time_off_types",
      "bamboohr_list_users",
      "bamboohr_table_rows",
      "bamboohr_time_off_balances",
      "bamboohr_time_off_requests",
      "bamboohr_training_records",
      "bamboohr_training_types",
      "bamboohr_vacation_overview",
      "bamboohr_whos_out",
    ]);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(t.description, t.name).toBeTruthy();
      expect(JSON.stringify(t.inputSchema)).not.toMatch(/token|companyDomain/);
    }
  });

  it("whos_out defaults to today through 14 days", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const result = await client.callTool({ name: "bamboohr_whos_out", arguments: {} });
    expect(api.getWhosOut).toHaveBeenCalledWith("2026-09-14", "2026-09-28");
    const text = (result.content as any[])[0].text;
    expect(JSON.parse(text)).toEqual([
      { id: 1, type: "timeOff", employeeId: 7, name: "Anna Tamm", start: "2026-09-14", end: "2026-09-28" },
    ]);
  });

  it("rejects an invalid date before calling the API", async () => {
    // The SDK may either return an isError result or throw an InvalidParams McpError
    // for arguments that fail the zod schema; accept both, but the API must not be hit.
    const api = fakeApi();
    const { client } = await connect(api);
    const outcome = await client
      .callTool({ name: "bamboohr_whos_out", arguments: { start: "14.09.2026" } })
      .then((r) => ({ kind: "result" as const, r }), (e) => ({ kind: "thrown" as const, e }));
    if (outcome.kind === "result") {
      expect(outcome.r.isError).toBe(true);
    } else {
      expect(String(outcome.e.message)).toMatch(/YYYY-MM-DD|Invalid arguments/);
    }
    expect(api.getWhosOut).not.toHaveBeenCalled();
  });

  it("vacation_overview returns the report", async () => {
    const { client } = await connect(fakeApi());
    const result = await client.callTool({ name: "bamboohr_vacation_overview", arguments: {} });
    const report = JSON.parse((result.content as any[])[0].text);
    expect(report.vacationType.id).toBe("78");
    expect(report.employees[0]).toMatchObject({ employeeId: 7, balance: 18, unplanned: 18, hasFourteenDayBlock: false });
  });

  it("passes time_off_requests filters through to the API", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    await client.callTool({
      name: "bamboohr_time_off_requests",
      arguments: { start: "2026-01-01", end: "2026-12-31", status: ["approved"], timeOffTypeId: "78" },
    });
    expect(api.getTimeOffRequests).toHaveBeenCalledWith({
      start: "2026-01-01", end: "2026-12-31", employeeId: undefined, status: ["approved"], typeIds: ["78"],
    });
  });

  it("rejects a time_off_requests range that ends before it starts, without calling the API", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const result = await client.callTool({
      name: "bamboohr_time_off_requests",
      arguments: { start: "2026-12-31", end: "2026-01-01" },
    });
    expect(result.isError).toBe(true);
    expect((result.content as any[])[0].text).toMatch(/must not be before/);
    expect(api.getTimeOffRequests).not.toHaveBeenCalled();
  });

  it("surfaces BambooHR errors as isError results", async () => {
    const api = fakeApi();
    (api.getBalances as any).mockRejectedValue(new Error("BambooHR returned 403 for /employees/7/time_off/calculator"));
    const { client } = await connect(api);
    const result = await client.callTool({ name: "bamboohr_time_off_balances", arguments: { employeeId: 7 } });
    expect(result.isError).toBe(true);
    expect((result.content as any[])[0].text).toMatch(/403/);
  });

  it("list_fields filters by search and only merges options when asked", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const plain = await client.callTool({ name: "bamboohr_list_fields", arguments: { search: "shoe" } });
    expect(JSON.parse((plain.content as any[])[0].text)).toEqual([{ id: "4471", name: "Shoe size", alias: "customShoeSize", type: "list" }]);
    expect(api.getListFields).not.toHaveBeenCalled();
    const withOptions = await client.callTool({ name: "bamboohr_list_fields", arguments: { search: "shoe", includeOptions: true } });
    expect(JSON.parse((withOptions.content as any[])[0].text)[0].options).toEqual([{ id: "90", name: "42", archived: false }]);
  });

  it("company_holidays defaults to the current calendar year and rejects end before start", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    await client.callTool({ name: "bamboohr_company_holidays", arguments: {} });
    expect(api.getHolidays).toHaveBeenCalledWith("2026-01-01", "2026-12-31");
    const bad = await client.callTool({ name: "bamboohr_company_holidays", arguments: { start: "2026-05-01", end: "2026-04-01" } });
    expect(bad.isError).toBe(true);
  });
  it("get_employee defaults to the caller's own record, compacts values and reports missing fields", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const res = await client.callTool({ name: "bamboohr_get_employee", arguments: { fields: ["firstName", "customShoeSize", "hireDate", "nope"] } });
    expect(api.getEmployee).toHaveBeenCalledWith(0, ["firstName", "customShoeSize", "hireDate", "nope"]);
    expect(JSON.parse((res.content as any[])[0].text)).toEqual({
      id: 0,
      fields: { firstName: "Anna", customShoeSize: "42" },
      missingFields: ["hireDate", "nope"],
    });
  });

  it("get_employee uses the default field set when none is given", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    await client.callTool({ name: "bamboohr_get_employee", arguments: { employeeId: 7 } });
    const fields = (api.getEmployee as any).mock.calls[0][1] as string[];
    expect(fields).toContain("hireDate");
    expect(fields).toContain("status");
  });

  it("employee_report always adds id, displayName and status, drops inactive rows by default and lists missing fields", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const res = await client.callTool({ name: "bamboohr_employee_report", arguments: { fields: ["customShoeSize", "hireDate"] } });
    expect((api.runCustomReport as any).mock.calls[0][0]).toEqual(["id", "displayName", "status", "customShoeSize", "hireDate"]);
    const body = JSON.parse((res.content as any[])[0].text);
    expect(body.employees).toEqual([{ id: 7, displayName: "Anna Tamm", status: "Active", customShoeSize: "42" }]);
    expect(body.missingFields).toEqual(["hireDate"]);
    expect(body.totalEmployees).toBe(2);
    expect(body.returnedEmployees).toBe(1);
  });

  it("employee_report keeps inactive rows when asked and rejects too many fields", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const res = await client.callTool({ name: "bamboohr_employee_report", arguments: { fields: ["customShoeSize"], includeInactive: true } });
    expect(JSON.parse((res.content as any[])[0].text).employees).toHaveLength(2);
    const tooMany = await client.callTool({ name: "bamboohr_employee_report", arguments: { fields: Array.from({ length: 398 }, (_, i) => `f${i}`) } });
    expect(tooMany.isError).toBe(true);
    expect(api.runCustomReport).toHaveBeenCalledTimes(1);
  });

  it("employee_report errors when none of the requested fields came back", async () => {
    const api = fakeApi();
    (api.runCustomReport as any).mockResolvedValueOnce({ fields: [{ id: "id", type: "int", name: "id" }], employees: [] });
    const { client } = await connect(api);
    const res = await client.callTool({ name: "bamboohr_employee_report", arguments: { fields: ["secretField"] } });
    expect(res.isError).toBe(true);
    expect((res.content as any[])[0].text).toMatch(/access level|field names/);
  });

  it("table_rows validates the alias against metadata and defaults to all employees", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const ok = await client.callTool({ name: "bamboohr_table_rows", arguments: { table: "customEquipment" } });
    expect(api.getTableRows).toHaveBeenCalledWith("customEquipment", "all");
    expect(JSON.parse((ok.content as any[])[0].text)).toEqual({ table: "customEquipment", rows: [{ id: 55, employeeId: 7, customItem: "Laptop" }] });
    const bad = await client.callTool({ name: "bamboohr_table_rows", arguments: { table: "nope", employeeId: 7 } });
    expect(bad.isError).toBe(true);
    expect((bad.content as any[])[0].text).toMatch(/jobInfo/);
    expect(api.getTables).toHaveBeenCalledTimes(1);
  });

  it("training_records fills in the type name from training types", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const res = await client.callTool({ name: "bamboohr_training_records", arguments: { employeeId: 7 } });
    expect(JSON.parse((res.content as any[])[0].text)).toEqual({
      employeeId: 7,
      records: [{ id: 21, trainingTypeId: 3, trainingTypeName: "First aid", completed: "2026-03-01" }],
    });
  });

  it("training_types returns types and categories together", async () => {
    const { client } = await connect(fakeApi());
    const res = await client.callTool({ name: "bamboohr_training_types", arguments: {} });
    const body = JSON.parse((res.content as any[])[0].text);
    expect(body.types[0].name).toBe("First aid");
    expect(body.categories).toEqual([{ id: 1, name: "Safety" }]);
  });
});
