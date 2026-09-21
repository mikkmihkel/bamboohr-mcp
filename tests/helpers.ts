import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHmac } from "node:crypto";
import { expect, vi } from "vitest";
import type { AuditEntry, AuditLog } from "../src/audit";
import type { BambooHRApi } from "../src/bamboohr";
import { DATA_ENVELOPE_HEADER, DATA_ENVELOPE_RE, dataBegin, dataEnd } from "../src/policy";
import { createServer, type ServerOptions } from "../src/server";

export const TODAY = "2026-09-14";

/** The text of the first content block of a tool result. */
export function toolText(result: unknown): string {
  return ((result as { content: { text: string }[] }).content[0].text);
}

/**
 * Assert the data envelope is present and return the payload it wraps. Every successful tool
 * result must go through this, which is what keeps the envelope from silently disappearing.
 */
export function parseToolPayload(result: unknown): any {
  return JSON.parse(envelopeBody(toolText(result)));
}

/**
 * Assert the data envelope is present, that its markers carry the nonce the header names, and
 * return the text between them. Every result the model sees must go through this.
 */
export function envelopeBody(text: string): string {
  expect(text.startsWith(DATA_ENVELOPE_HEADER), "result is not enveloped").toBe(true);
  const match = DATA_ENVELOPE_RE.exec(text);
  expect(match, "result has no nonce-tagged data block").not.toBeNull();
  const [, nonce, body] = match!;
  // The header must name the same nonce as the markers, and the markers must be the only ones.
  expect(text).toContain(nonce);
  expect(text.indexOf(dataBegin(nonce))).toBeGreaterThan(text.indexOf(nonce));
  expect(text.endsWith(dataEnd(nonce))).toBe(true);
  return body;
}

export interface RecordingAudit extends AuditLog {
  entries: AuditEntry[];
}

/** An audit log that keeps entries in memory and hashes ids the way the real one does. */
export function recordingAudit(): RecordingAudit {
  const entries: AuditEntry[] = [];
  return {
    dir: "",
    file: "",
    entries,
    write(entry: AuditEntry) {
      entries.push(entry);
    },
    hashEmployeeId: (id: number | string) =>
      createHmac("sha256", "test-salt").update(String(id)).digest("hex").slice(0, 16),
  };
}

export function fakeApi(overrides: Partial<BambooHRApi> = {}): BambooHRApi {
  return {
    getWhosOut: vi.fn(async (start: string, end: string) => [
      { id: 1, type: "timeOff" as const, employeeId: 7, name: "Anna Tamm", start, end },
    ]),
    getDirectory: vi.fn(async () => [
      { id: 7, displayName: "Anna Tamm", firstName: "Anna", lastName: "Tamm", department: "Engineering", location: "Tallinn", workEmail: "anna@acme.test" },
      { id: 8, displayName: "Mart Mets", firstName: "Mart", lastName: "Mets", department: "Sales", location: "Tartu", workEmail: "mart@acme.test" },
    ]),
    getTimeOffTypes: vi.fn(async () => ({
      timeOffTypes: [
        { id: "78", name: "Vacation", units: "days" as const },
        { id: "1", name: "Sick leave", units: "days" as const },
      ],
      defaultHours: [],
    })),
    getBalances: vi.fn(async () => [
      { timeOffTypeId: "78", name: "Vacation", units: "days", balance: 18, usedYearToDate: 10, policyType: "accruing", asOf: TODAY },
      { timeOffTypeId: "1", name: "Sick leave", units: "days", balance: 4, usedYearToDate: 3, policyType: "accruing", asOf: TODAY },
    ]),
    getTimeOffRequests: vi.fn(async () => []),
    getFields: vi.fn(async () => [
      { id: "1", name: "First name", alias: "firstName", type: "text" },
      { id: "17", name: "Pay rate", alias: "payRate", type: "currency" },
      { id: "18", name: "Date of birth", alias: "dateOfBirth", type: "date" },
      { id: "4471", name: "Shoe size", alias: "customShoeSize", type: "list" },
      { id: "4472", name: "Bonus scheme", alias: "customBonusScheme", type: "text" },
    ]),
    getListFields: vi.fn(async () => [
      { listId: "8", fieldId: "4471", alias: "customShoeSize", name: "Shoe size", manageable: true, multiple: false, options: [{ id: "90", name: "42", archived: false }] },
    ]),
    getTables: vi.fn(async () => [
      { alias: "jobInfo", fields: [] },
      { alias: "compensation", fields: [] },
      { alias: "customEquipment", fields: [] },
    ]),
    getHolidays: vi.fn(async () => []),
    getUsers: vi.fn(async () => [
      { userId: 1, employeeId: 7, firstName: "Anna", lastName: "Tamm", email: "anna@acme.test", status: "enabled" },
      { userId: 2, employeeId: 8, firstName: "Mart", lastName: "Mets", email: "mart@acme.test", status: "disabled" },
    ]),
    getEmployee: vi.fn(async (id: number) => ({
      id,
      values: { id: String(id), firstName: "Anna", customShoeSize: "42", hireDate: "" },
    })),
    runCustomReport: vi.fn(async (fields: string[]) => ({
      fields: fields.filter((f) => f !== "hireDate").map((f) => ({ id: f, type: "text", name: f })),
      employees: [
        { id: 7, displayName: "Anna Tamm", status: "Active", department: "Engineering", location: "Tallinn", customShoeSize: "42" },
        { id: 8, displayName: "Old Hand", status: "Inactive", department: "Engineering", location: "Tartu", customShoeSize: "44" },
        { id: 9, displayName: "Mart Mets", status: "Active", department: "Sales", location: "Tartu", customShoeSize: "45" },
      ],
    })),
    getTableRows: vi.fn(async () => [{ id: 55, employeeId: 7, customItem: "Laptop" }]),
    getChangedEmployees: vi.fn(async () => ({ latest: "", employees: [] })),
    getTrainingTypes: vi.fn(async () => [{ id: 3, name: "First aid", required: false, renewable: true, frequencyMonths: 24 }]),
    getTrainingCategories: vi.fn(async () => [{ id: 1, name: "Safety" }]),
    getTrainingRecords: vi.fn(async () => [{ id: 21, trainingTypeId: 3, completed: "2026-03-01" }]),
    getDependents: vi.fn(async () => []),
    getEmployeeFiles: vi.fn(async () => []),
    ...overrides,
  };
}

export async function connect(api: BambooHRApi, options: ServerOptions = {}) {
  const audit = (options.audit as RecordingAudit | undefined) ?? recordingAudit();
  const server = createServer(api, { today: () => TODAY, ...options, audit });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return { client, server, audit: audit as RecordingAudit };
}
