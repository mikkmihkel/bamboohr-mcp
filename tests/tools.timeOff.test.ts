import { describe, expect, it, vi } from "vitest";
import type { TimeOffRequest } from "../src/types";
import { connect, envelopeBody, fakeApi, parseToolPayload, toolText, TODAY } from "./helpers";

function request(overrides: Partial<TimeOffRequest> = {}): TimeOffRequest {
  return {
    id: 1,
    employeeId: 7,
    employeeName: "Anna Tamm",
    start: "2026-10-01",
    end: "2026-10-05",
    created: "2026-09-01",
    status: "approved",
    typeId: "78",
    typeName: "Vacation",
    amount: 5,
    unit: "days",
    ...overrides,
  };
}

describe("bamboohr_whos_out", () => {
  it("refuses a range with more entries than the per-call limit", async () => {
    const api = fakeApi({
      getWhosOut: vi.fn(async () =>
        Array.from({ length: 3 }, (_, i) => ({ id: i, type: "timeOff" as const, employeeId: i, name: `E${i}`, start: TODAY, end: TODAY }))
      ),
    });
    const { client, audit } = await connect(api, { settings: { maxRecords: 2 } });
    const res = await client.callTool({ name: "bamboohr_whos_out", arguments: {} });
    expect(res.isError).toBe(true);
    expect(toolText(res)).toMatch(/above the per-call limit of 2\. Use a shorter date range\./);
    expect(audit.entries[0]).toMatchObject({ outcome: "rejected", error: "PolicyError record_limit" });
  });
});

describe("bamboohr_list_employees", () => {
  it("requires search, department or location", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const res = await client.callTool({ name: "bamboohr_list_employees", arguments: {} });
    expect(res.isError).toBe(true);
    expect(toolText(res)).toMatch(/requires search, department or location/);
    expect(api.getDirectory).not.toHaveBeenCalled();
  });

  it("filters by search word, department and location", async () => {
    const { client } = await connect(fakeApi());
    const bySearch = await client.callTool({ name: "bamboohr_list_employees", arguments: { search: "tamm" } });
    expect(parseToolPayload(bySearch).map((e: any) => e.id)).toEqual([7]);
    const byEmail = await client.callTool({ name: "bamboohr_list_employees", arguments: { search: "mart@acme" } });
    expect(parseToolPayload(byEmail).map((e: any) => e.id)).toEqual([8]);
    const byDept = await client.callTool({ name: "bamboohr_list_employees", arguments: { department: "sales" } });
    expect(parseToolPayload(byDept).map((e: any) => e.id)).toEqual([8]);
    const byLocation = await client.callTool({ name: "bamboohr_list_employees", arguments: { location: "Tallinn" } });
    expect(parseToolPayload(byLocation).map((e: any) => e.id)).toEqual([7]);
  });

  it("refuses a result above the per-call limit and hints at narrowing it", async () => {
    const { client } = await connect(fakeApi(), { settings: { maxRecords: 1 } });
    const res = await client.callTool({ name: "bamboohr_list_employees", arguments: { search: "acme" } });
    expect(res.isError).toBe(true);
    expect(toolText(res)).toMatch(/Add a more specific search word or a department\/location filter\./);
  });
});

describe("bamboohr_list_time_off_types", () => {
  it("omits health-related types, so their ids are never handed to the model", async () => {
    const { client } = await connect(fakeApi());
    const res = await client.callTool({ name: "bamboohr_list_time_off_types", arguments: {} });
    const body = parseToolPayload(res);
    expect(body.timeOffTypes.map((t: any) => t.name)).toEqual(["Vacation"]);
    expect(toolText(res)).not.toContain("Sick");
  });
});

describe("bamboohr_time_off_balances", () => {
  it("drops health-related balances", async () => {
    const { client } = await connect(fakeApi());
    const res = await client.callTool({ name: "bamboohr_time_off_balances", arguments: { employeeId: 7 } });
    const balances = parseToolPayload(res);
    expect(balances.map((b: any) => b.name)).toEqual(["Vacation"]);
    expect(toolText(res)).not.toContain("Sick");
  });
});

describe("bamboohr_time_off_requests", () => {
  it("passes the filters through and reduces health-related requests", async () => {
    const api = fakeApi({
      getTimeOffRequests: vi.fn(async () => [
        request({ id: 1 }),
        request({ id: 2, typeId: "1", typeName: "Sick leave", notes: { employee: "flu", manager: "get well" } }),
      ]),
    });
    const { client, audit } = await connect(api);
    const res = await client.callTool({
      name: "bamboohr_time_off_requests",
      arguments: { start: "2026-01-01", end: "2026-12-31", status: ["approved"], timeOffTypeId: "78" },
    });
    expect(api.getTimeOffRequests).toHaveBeenCalledWith({
      start: "2026-01-01", end: "2026-12-31", employeeId: undefined, status: ["approved"], typeIds: ["78"],
    });
    const body = parseToolPayload(res);
    expect(body[0]).toMatchObject({ id: 1, typeName: "Vacation", typeId: "78" });
    expect(body[1]).toMatchObject({ id: 2, typeName: "absent", typeId: "" });
    expect(body[1].notes).toBeUndefined();
    // How much sick leave, and in what unit, is health data of its own.
    expect(body[1].amount).toBeUndefined();
    expect(body[1].unit).toBeUndefined();
    expect(body[0].amount).toBe(5);
    expect(toolText(res)).not.toMatch(/Sick leave|flu/);
    expect(audit.entries[0].filters).toEqual({
      start: "2026-01-01", end: "2026-12-31", status: ["approved"], timeOffTypeId: "78",
    });
  });

  it("refuses a health-related time-off type id before calling the API", async () => {
    const api = fakeApi();
    const { client, audit } = await connect(api);
    const res = await client.callTool({
      name: "bamboohr_time_off_requests",
      arguments: { start: "2026-01-01", end: "2026-12-31", timeOffTypeId: "1" },
    });
    expect(res.isError).toBe(true);
    expect(toolText(res)).toMatch(/health-related and excluded by policy/);
    expect(api.getTimeOffRequests).not.toHaveBeenCalled();
    expect(audit.entries[0]).toMatchObject({ outcome: "rejected", error: "PolicyError tool_disabled" });
  });

  it("lets an unknown type id through to BambooHR", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const res = await client.callTool({
      name: "bamboohr_time_off_requests",
      arguments: { start: "2026-01-01", end: "2026-12-31", timeOffTypeId: "9999" },
    });
    expect(res.isError).toBeFalsy();
    expect(api.getTimeOffRequests).toHaveBeenCalledWith(
      expect.objectContaining({ typeIds: ["9999"] })
    );
  });

  it("rejects a time-off type id that is not a number", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const outcome = await client
      .callTool({
        name: "bamboohr_time_off_requests",
        arguments: { start: "2026-01-01", end: "2026-12-31", timeOffTypeId: "1 OR notes" },
      })
      .then((r) => ({ kind: "result" as const, r }), (e) => ({ kind: "thrown" as const, e }));
    if (outcome.kind === "result") expect(outcome.r.isError).toBe(true);
    else expect(String(outcome.e.message)).toMatch(/Invalid arguments|numeric time-off type id/);
    expect(api.getTimeOffRequests).not.toHaveBeenCalled();
  });

  it("rejects a range that ends before it starts, without calling the API", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const res = await client.callTool({
      name: "bamboohr_time_off_requests",
      arguments: { start: "2026-12-31", end: "2026-01-01" },
    });
    expect(res.isError).toBe(true);
    expect(toolText(res)).toMatch(/must not be before/);
    expect(api.getTimeOffRequests).not.toHaveBeenCalled();
  });

  it("refuses more requests than the per-call limit and hashes the employee id it logged", async () => {
    const api = fakeApi({ getTimeOffRequests: vi.fn(async () => [request({ id: 1 }), request({ id: 2 })]) });
    const { client, audit } = await connect(api, { settings: { maxRecords: 1 } });
    const res = await client.callTool({
      name: "bamboohr_time_off_requests",
      arguments: { start: "2026-01-01", end: "2026-12-31", employeeId: 7 },
    });
    expect(res.isError).toBe(true);
    expect(toolText(res)).toMatch(/Use a shorter range, one employeeId or a status filter\./);
    expect(audit.entries[0].employeeIds).toEqual([expect.stringMatching(/^[0-9a-f]{16}$/)]);
    expect(audit.entries[0].employeeIds).not.toContain("7");
  });
});

describe("bamboohr_vacation_overview", () => {
  it("requires a department or employeeIds", async () => {
    const api = fakeApi();
    const { client, audit } = await connect(api);
    const res = await client.callTool({ name: "bamboohr_vacation_overview", arguments: {} });
    expect(res.isError).toBe(true);
    expect(toolText(res)).toMatch(/requires a department or employeeIds/);
    expect(api.getDirectory).not.toHaveBeenCalled();
    expect(audit.entries[0].error).toBe("PolicyError filter_required");
  });

  it("builds the report for one department", async () => {
    const { client, audit } = await connect(fakeApi());
    const res = await client.callTool({
      name: "bamboohr_vacation_overview",
      arguments: { department: "Engineering", onlyMissingFourteenDayBlock: true },
    });
    const report = parseToolPayload(res);
    expect(report.vacationType.id).toBe("78");
    expect(report.employees).toHaveLength(1);
    expect(report.employees[0]).toMatchObject({ employeeId: 7, balance: 18, unplanned: 18, hasFourteenDayBlock: false });
    expect(audit.entries[0]).toMatchObject({
      outcome: "ok",
      recordCount: 1,
      filters: { department: "Engineering", onlyMissingFourteenDayBlock: true },
    });
  });

  it("narrows to employeeIds and caps the group before fetching balances", async () => {
    const api = fakeApi();
    const { client } = await connect(api);
    const res = await client.callTool({ name: "bamboohr_vacation_overview", arguments: { employeeIds: [8] } });
    expect(parseToolPayload(res).employees.map((e: any) => e.employeeId)).toEqual([8]);
    expect(api.getBalances).toHaveBeenCalledTimes(1);

    const capped = fakeApi();
    const { client: capClient, audit } = await connect(capped, { settings: { maxRecords: 1 } });
    const tooMany = await capClient.callTool({ name: "bamboohr_vacation_overview", arguments: { employeeIds: [7, 8] } });
    expect(tooMany.isError).toBe(true);
    expect(toolText(tooMany)).toMatch(/Choose a smaller department or pass employeeIds\./);
    expect(capped.getBalances).not.toHaveBeenCalled();
    expect(audit.entries[0].error).toBe("PolicyError record_limit");
  });

  it("keeps the JSON error shape when the vacation type cannot be resolved", async () => {
    const api = fakeApi();
    const { client, audit } = await connect(api);
    const res = await client.callTool({
      name: "bamboohr_vacation_overview",
      arguments: { department: "Engineering", timeOffType: "Sabbatical" },
    });
    expect(res.isError).toBe(true);
    // The message quotes BambooHR's own type names: it is fenced like any other payload.
    const body = JSON.parse(envelopeBody(toolText(res)));
    expect(body.error).toMatch(/No time-off type matches "Sabbatical"/);
    expect(body.availableTypes.map((t: any) => t.id)).toEqual(["78", "1"]);
    expect(audit.entries[0]).toMatchObject({ outcome: "error", error: "VacationTypeNotFoundError" });
  });
});
