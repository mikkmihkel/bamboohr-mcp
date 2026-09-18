import { describe, expect, it, vi } from "vitest";
import type { Client } from "../src/client";
import { createBambooHRApi } from "../src/bamboohr";

function clientReturning(payload: unknown) {
  const get = vi.fn(async () => payload);
  return { client: { get } as unknown as Client, get };
}

describe("createBambooHRApi", () => {
  it("getWhosOut passes dates and normalises ids to numbers", async () => {
    const { client, get } = clientReturning([
      { id: "101", type: "timeOff", employeeId: "7", name: "Anna Tamm", start: "2026-09-14", end: "2026-09-16" },
      { id: "5", type: "holiday", name: "Independence Day", start: "2026-02-24", end: "2026-02-24" },
    ]);
    const out = await createBambooHRApi(client).getWhosOut("2026-09-14", "2026-09-28");
    expect(get).toHaveBeenCalledWith("/time_off/whos_out", { start: "2026-09-14", end: "2026-09-28", filter: "off" });
    expect(out).toEqual([
      { id: 101, type: "timeOff", employeeId: 7, name: "Anna Tamm", start: "2026-09-14", end: "2026-09-16" },
      { id: 5, type: "holiday", name: "Independence Day", start: "2026-02-24", end: "2026-02-24" },
    ]);
  });

  it("getWhosOut maps a missing name to an empty string, never the literal \"undefined\"", async () => {
    const { client } = clientReturning([
      { id: "5", type: "holiday", start: "2026-02-24", end: "2026-02-24" },
    ]);
    const out = await createBambooHRApi(client).getWhosOut("2026-09-14", "2026-09-28");
    expect(out).toEqual([
      { id: 5, type: "holiday", name: "", start: "2026-02-24", end: "2026-02-24" },
    ]);
  });

  it("getDirectory keeps only known fields and numeric ids", async () => {
    const { client, get } = clientReturning({
      fields: [{ id: "displayName", type: "text", name: "Display name" }],
      employees: [
        { id: "7", displayName: "Anna Tamm", firstName: "Anna", lastName: "Tamm", jobTitle: "Engineer", department: "Engineering",
          division: "", location: "Tallinn", supervisor: "Mart Mets", workEmail: "anna@example.com", canUploadPhoto: 0, photoUrl: "http://x" },
      ],
    });
    const employees = await createBambooHRApi(client).getDirectory();
    expect(get).toHaveBeenCalledWith("/employees/directory");
    expect(employees).toEqual([
      { id: 7, displayName: "Anna Tamm", firstName: "Anna", lastName: "Tamm", jobTitle: "Engineer", department: "Engineering",
        location: "Tallinn", supervisor: "Mart Mets", workEmail: "anna@example.com" },
    ]);
  });

  it("getTimeOffTypes converts default hour amounts to numbers", async () => {
    const { client, get } = clientReturning({
      timeOffTypes: [{ id: "78", name: "Vacation", units: "days", color: "56afdd", icon: "airplane", source: "internal" }],
      defaultHours: [{ name: "Monday", amount: "8" }],
    });
    const types = await createBambooHRApi(client).getTimeOffTypes();
    expect(get).toHaveBeenCalledWith("/meta/time_off/types");
    expect(types).toEqual({
      timeOffTypes: [{ id: "78", name: "Vacation", units: "days" }],
      defaultHours: [{ name: "Monday", amount: 8 }],
    });
  });

  it("getBalances calls the calculator and converts numeric strings", async () => {
    const { client, get } = clientReturning([
      { timeOffType: "78", name: "Vacation", units: "days", balance: "18.00", end: "2026-09-14", policyType: "accruing", usedYearToDate: "10.00" },
    ]);
    const balances = await createBambooHRApi(client).getBalances(7, "2026-09-14");
    expect(get).toHaveBeenCalledWith("/employees/7/time_off/calculator", { end: "2026-09-14" });
    expect(balances).toEqual([
      { timeOffTypeId: "78", name: "Vacation", units: "days", balance: 18, usedYearToDate: 10, policyType: "accruing", asOf: "2026-09-14" },
    ]);
  });

  it("getTimeOffRequests joins filters and flattens the response", async () => {
    const { client, get } = clientReturning([
      {
        id: "1348", employeeId: "7", name: "Anna Tamm", start: "2026-07-06", end: "2026-07-19", created: "2026-05-02",
        status: { status: "approved", lastChanged: "2026-05-03", lastChangedByUserId: "2" },
        type: { id: "78", name: "Vacation", icon: "airplane" },
        amount: { unit: "days", amount: 10 },
        notes: { employee: "Summer" },
        dates: { "2026-07-06": 1 },
      },
    ]);
    const requests = await createBambooHRApi(client).getTimeOffRequests({
      start: "2026-01-01", end: "2026-12-31", employeeId: 7, status: ["approved", "requested"], typeIds: ["78"],
    });
    expect(get).toHaveBeenCalledWith("/time_off/requests", {
      start: "2026-01-01", end: "2026-12-31", employeeId: 7, status: "approved,requested", type: "78",
    });
    expect(requests).toEqual([
      {
        id: 1348, employeeId: 7, employeeName: "Anna Tamm", start: "2026-07-06", end: "2026-07-19", created: "2026-05-02",
        status: "approved", typeId: "78", typeName: "Vacation", amount: 10, unit: "days", notes: { employee: "Summer" },
      },
    ]);
  });

  it("getTimeOffRequests maps a missing type object to empty strings, never the literal \"undefined\"", async () => {
    const { client } = clientReturning([
      {
        id: "1349", employeeId: "7", name: "Anna Tamm", start: "2026-07-06", end: "2026-07-19", created: "2026-05-02",
        status: { status: "approved" },
        amount: { unit: "days", amount: 10 },
      },
    ]);
    const requests = await createBambooHRApi(client).getTimeOffRequests({ start: "2026-01-01", end: "2026-12-31" });
    expect(requests).toEqual([
      {
        id: 1349, employeeId: 7, employeeName: "Anna Tamm", start: "2026-07-06", end: "2026-07-19", created: "2026-05-02",
        status: "approved", typeId: "", typeName: "", amount: 10, unit: "days",
      },
    ]);
  });

  it("getTimeOffRequests omits empty status and type lists instead of sending blank values", async () => {
    const { client, get } = clientReturning([]);
    await createBambooHRApi(client).getTimeOffRequests({ start: "2026-01-01", end: "2026-01-31", status: [], typeIds: [] });
    expect(get).toHaveBeenCalledWith("/time_off/requests", {
      start: "2026-01-01", end: "2026-01-31", employeeId: undefined, status: undefined, type: undefined,
    });
  });

  it("getTimeOffRequests omits optional filters when not given", async () => {
    const { client, get } = clientReturning([]);
    await createBambooHRApi(client).getTimeOffRequests({ start: "2026-01-01", end: "2026-01-31" });
    expect(get).toHaveBeenCalledWith("/time_off/requests", {
      start: "2026-01-01", end: "2026-01-31", employeeId: undefined, status: undefined, type: undefined,
    });
  });

  it("getFields normalises ids to strings and keeps alias and deprecated flags", async () => {
    const { client, get } = clientReturning([
      { id: 1, name: "First name", type: "text", alias: "firstName" },
      { id: "4340.4", name: "Sub", type: "text", deprecated: true },
    ]);
    const out = await createBambooHRApi(client).getFields();
    expect(get).toHaveBeenCalledWith("/meta/fields");
    expect(out).toEqual([
      { id: "1", name: "First name", type: "text", alias: "firstName" },
      { id: "4340.4", name: "Sub", type: "text", deprecated: true },
    ]);
  });

  it("getListFields flattens options and converts yes/no to booleans", async () => {
    const { client, get } = clientReturning([
      { id: "3", fieldId: "4", alias: "department", manageable: "yes", multiple: "no", name: "Department",
        options: [{ id: "45", archived: "no", name: "Engineering" }, { id: "46", archived: "yes", name: "Legacy" }] },
    ]);
    const out = await createBambooHRApi(client).getListFields();
    expect(get).toHaveBeenCalledWith("/meta/lists");
    expect(out).toEqual([
      { listId: "3", fieldId: "4", alias: "department", name: "Department", manageable: true, multiple: false,
        options: [{ id: "45", name: "Engineering", archived: false }, { id: "46", name: "Legacy", archived: true }] },
    ]);
  });

  it("getTables returns aliases and typed fields", async () => {
    const { client } = clientReturning([
      { alias: "customEquipment", fields: [{ id: 4500, name: "Item", alias: "customItem", type: "text" }] },
    ]);
    expect(await createBambooHRApi(client).getTables()).toEqual([
      { alias: "customEquipment", fields: [{ id: "4500", name: "Item", alias: "customItem", type: "text" }] },
    ]);
  });

  it("getHolidays follows pages and filters by overlap", async () => {
    const pages = [
      { data: [{ id: 1, name: "New Year", startDate: "2026-01-01", endDate: "2026-01-01", isPublic: true }], meta: { page: 1, pageSize: 100, totalPages: 2, totalItems: 2 } },
      { data: [{ id: 2, name: "Midsummer", startDate: "2026-06-23", endDate: "2026-06-24", isPublic: true }], meta: { page: 2, pageSize: 100, totalPages: 2, totalItems: 2 } },
    ];
    const get = vi.fn(async () => pages.shift());
    const out = await createBambooHRApi({ get } as unknown as Client).getHolidays("2026-01-01", "2026-12-31");
    expect(get).toHaveBeenNthCalledWith(1, "/holidays", {
      filter: "startDate le '2026-12-31' and endDate ge '2026-01-01'", orderBy: "startDate asc", pageSize: 100, page: 1,
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(out.map((h) => h.name)).toEqual(["New Year", "Midsummer"]);
  });

  it("getUsers flattens the id-keyed object", async () => {
    const { client, get } = clientReturning({
      "11": { id: "11", employeeId: "7", firstName: "Anna", lastName: "Tamm", email: "anna@example.com", status: "enabled", lastLogin: "2026-09-01T08:00:00+00:00" },
      "12": { id: "12", employeeId: null, firstName: "Svc", lastName: "Acct", email: null, status: "disabled" },
    });
    const out = await createBambooHRApi(client).getUsers("enabled");
    expect(get).toHaveBeenCalledWith("/meta/users", { status: "enabled" });
    expect(out).toEqual([
      { userId: 11, employeeId: 7, firstName: "Anna", lastName: "Tamm", email: "anna@example.com", status: "enabled", lastLogin: "2026-09-01T08:00:00+00:00" },
      { userId: 12, firstName: "Svc", lastName: "Acct", status: "disabled" },
    ]);
  });
  it("getEmployee joins fields, uses onlyCurrent and returns raw values", async () => {
    const { client, get } = clientReturning({ id: "7", firstName: "Anna", customShoeSize: "42", hireDate: "" });
    const out = await createBambooHRApi(client).getEmployee(7, ["firstName", "customShoeSize", "hireDate"]);
    expect(get).toHaveBeenCalledWith("/employees/7", { fields: "firstName,customShoeSize,hireDate", onlyCurrent: true });
    expect(out).toEqual({ id: 7, values: { id: "7", firstName: "Anna", customShoeSize: "42", hireDate: "" } });
  });

  it("runCustomReport posts the field list with JSON format and coerces ids", async () => {
    const post = vi.fn(async () => ({
      title: "r",
      fields: [{ id: "id", type: "int", name: "EEID" }, { id: "customShoeSize", type: "list", name: "Shoe size" }],
      employees: [{ id: "7", customShoeSize: "42" }, { id: "8", customShoeSize: "" }],
    }));
    const api = createBambooHRApi({ post } as unknown as Client);
    const out = await api.runCustomReport(["id", "customShoeSize"], [7, 8]);
    expect(post).toHaveBeenCalledWith(
      "/reports/custom",
      { title: "bamboohr-mcp report", fields: ["id", "customShoeSize"], filters: { employeeIds: [7, 8] } },
      { format: "JSON", onlyCurrent: true }
    );
    expect(out.fields).toEqual([{ id: "id", type: "int", name: "EEID" }, { id: "customShoeSize", type: "list", name: "Shoe size" }]);
    expect(out.employees).toEqual([{ id: 7, customShoeSize: "42" }, { id: 8 }]);
  });

  it("runCustomReport omits filters when no employee ids are given", async () => {
    const post = vi.fn(async () => ({ fields: [], employees: [] }));
    await createBambooHRApi({ post } as unknown as Client).runCustomReport(["id"]);
    expect((post.mock.calls[0] as any[])[1]).toEqual({ title: "bamboohr-mcp report", fields: ["id"] });
  });

  it("getTableRows supports 'all' and coerces row and employee ids", async () => {
    const { client, get } = clientReturning([{ id: "55", employeeId: "7", customItem: "Laptop", customSerial: "" }]);
    const out = await createBambooHRApi(client).getTableRows("customEquipment", "all");
    expect(get).toHaveBeenCalledWith("/employees/all/tables/customEquipment");
    expect(out).toEqual([{ id: 55, employeeId: 7, customItem: "Laptop" }]);
  });

  it("getChangedEmployees flattens and sorts newest first", async () => {
    const { client, get } = clientReturning({
      latest: "2026-09-15T10:00:00+00:00",
      employees: {
        "7": { id: "7", action: "Updated", lastChanged: "2026-09-14T10:00:00+00:00" },
        "9": { id: "9", action: "Inserted", lastChanged: "2026-09-15T10:00:00+00:00" },
      },
    });
    const out = await createBambooHRApi(client).getChangedEmployees("2026-09-01T00:00:00+00:00", "updated");
    expect(get).toHaveBeenCalledWith("/employees/changed", { since: "2026-09-01T00:00:00+00:00", type: "updated" });
    expect(out.latest).toBe("2026-09-15T10:00:00+00:00");
    expect(out.employees.map((e) => e.id)).toEqual([9, 7]);
  });

  it("getTrainingTypes flattens the id-keyed object and normalises flags", async () => {
    const { client, get } = clientReturning({
      "3": { id: "3", name: "First aid", renewable: "1", frequency: "24", required: "0", dueFromHireDate: null,
             category: { id: "1", name: "Safety" }, linkUrl: "", description: "Basic course", allowEmployeesToMarkComplete: "1" },
    });
    const out = await createBambooHRApi(client).getTrainingTypes();
    expect(get).toHaveBeenCalledWith("/training/type");
    expect(out).toEqual([{ id: 3, name: "First aid", category: "Safety", required: false, renewable: true, frequencyMonths: 24, description: "Basic course" }]);
  });

  it("getTrainingCategories flattens the id-keyed object", async () => {
    const { client, get } = clientReturning({ "1": { id: "1", name: "Safety" } });
    expect(await createBambooHRApi(client).getTrainingCategories()).toEqual([{ id: 1, name: "Safety" }]);
    expect(get).toHaveBeenCalledWith("/training/category");
  });

  it("getTrainingRecords handles the empty-array and id-keyed shapes", async () => {
    const empty = clientReturning([]);
    expect(await createBambooHRApi(empty.client).getTrainingRecords(7)).toEqual([]);
    expect(empty.get).toHaveBeenCalledWith("/training/record/employee/7", { type: undefined });

    const { client, get } = clientReturning({
      "21": { id: "21", employeeId: "7", type: "3", completed: "2026-03-01", instructor: "Dr X", hours: "4", credits: "", notes: null, cost: { currency: "EUR", amount: "100.00" } },
    });
    expect(await createBambooHRApi(client).getTrainingRecords(7, 3)).toEqual([
      { id: 21, trainingTypeId: 3, completed: "2026-03-01", instructor: "Dr X", hours: 4, cost: { currency: "EUR", amount: "100.00" } },
    ]);
    expect(get).toHaveBeenCalledWith("/training/record/employee/7", { type: 3 });
  });

  it("getDependents unwraps the odd top-level key and compacts values", async () => {
    const { client, get } = clientReturning({ "Employee Dependents": [{ id: "5", employeeId: "7", firstName: "Liis", relationship: "Child", ssn: "" }] });
    expect(await createBambooHRApi(client).getDependents(7)).toEqual([{ id: 5, employeeId: 7, firstName: "Liis", relationship: "Child" }]);
    expect(get).toHaveBeenCalledWith("/employeedependents", { employeeid: 7 });
  });

  it("getEmployeeFiles keeps categories and file metadata, drops permission flags", async () => {
    const { client, get } = clientReturning({
      employee: { id: 7 },
      categories: [{ id: 1, name: "Contracts", canRenameCategory: "no", canDeleteCategory: "no", canUploadFiles: "yes", displayIfEmpty: "yes",
        files: [{ id: 99, name: "contract.pdf", originalFileName: "contract.pdf", size: 1234, dateCreated: "2026-01-05 10:00:00", createdBy: "HR", shareWithEmployee: "yes", canRenameFile: "no" }] }],
    });
    expect(await createBambooHRApi(client).getEmployeeFiles(7)).toEqual([
      { id: 1, name: "Contracts", files: [{ id: 99, name: "contract.pdf", originalFileName: "contract.pdf", size: 1234, dateCreated: "2026-01-05 10:00:00", createdBy: "HR", shareWithEmployee: true }] },
    ]);
    expect(get).toHaveBeenCalledWith("/employees/7/files/view");
  });
});
