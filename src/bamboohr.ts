import type { Client } from "./client";
import { addDays, type ISODate } from "./dates";
import { compact } from "./fields";
import type {
  BambooUser,
  ChangedEmployee,
  CustomReport,
  Dependent,
  DirectoryEmployee,
  EmployeeFile,
  FieldMeta,
  FileCategory,
  Holiday,
  ListFieldMeta,
  ReportRow,
  RequestStatus,
  TableMeta,
  TableRow,
  TimeOffBalance,
  TimeOffRequest,
  TimeOffType,
  TimeOffTypesResponse,
  TrainingCategory,
  TrainingRecord,
  TrainingType,
  WhosOutEntry,
} from "./types";

export interface RequestsQuery {
  start: ISODate;
  end: ISODate;
  employeeId?: number;
  status?: RequestStatus[];
  typeIds?: string[];
}

export interface BambooHRApi {
  getWhosOut(start: ISODate, end: ISODate): Promise<WhosOutEntry[]>;
  getDirectory(): Promise<DirectoryEmployee[]>;
  getTimeOffTypes(): Promise<TimeOffTypesResponse>;
  getBalances(employeeId: number, asOf: ISODate): Promise<TimeOffBalance[]>;
  getTimeOffRequests(q: RequestsQuery): Promise<TimeOffRequest[]>;
  getFields(): Promise<FieldMeta[]>;
  getListFields(): Promise<ListFieldMeta[]>;
  getTables(): Promise<TableMeta[]>;
  getHolidays(start: ISODate, end: ISODate): Promise<Holiday[]>;
  getUsers(status?: "enabled" | "disabled"): Promise<BambooUser[]>;
  getEmployee(employeeId: number, fields: string[]): Promise<{ id: number; values: Record<string, unknown> }>;
  runCustomReport(fields: string[], employeeIds?: number[]): Promise<CustomReport>;
  getTableRows(table: string, employeeId: number | "all"): Promise<TableRow[]>;
  getChangedEmployees(since: string, type?: "inserted" | "updated" | "deleted"): Promise<{ latest: string; employees: ChangedEmployee[] }>;
  getTrainingTypes(): Promise<TrainingType[]>;
  getTrainingCategories(): Promise<TrainingCategory[]>;
  getTrainingRecords(employeeId: number, trainingTypeId?: number): Promise<TrainingRecord[]>;
  getDependents(employeeId?: number): Promise<Dependent[]>;
  getEmployeeFiles(employeeId: number): Promise<FileCategory[]>;
}

// Trust boundary: this module trusts BambooHR's documented API contract that
// ids (employee ids, time-off type ids, request ids) are always present and
// well-formed. Malformed payloads are not validated here — `Number(...)` on a
// missing id will surface as `NaN` rather than being caught at this layer.
type Raw = Record<string, any>;

const DIRECTORY_FIELDS = [
  "displayName", "firstName", "lastName", "jobTitle", "department",
  "division", "location", "supervisor", "workEmail",
] as const;

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

function yesNo(v: unknown): boolean {
  return String(v).toLowerCase() === "yes" || v === true;
}

/** BambooHR training flags arrive as "1"/"0", true/false or "yes"/"no". */
function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || String(v).toLowerCase() === "yes" || v === "true";
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function createBambooHRApi(client: Client): BambooHRApi {
  return {
    async getWhosOut(start, end) {
      // filter=off: without it BambooHR narrows results to the API key owner's
      // saved Who's Out calendar filter, silently hiding part of the company.
      const raw = await client.get<Raw[]>("/time_off/whos_out", { start, end, filter: "off" });
      return raw.map((r) => {
        const entry: WhosOutEntry = {
          id: Number(r.id),
          type: r.type,
          name: str(r.name) ?? "",
          start: r.start,
          end: r.end,
        };
        if (r.employeeId !== undefined && r.employeeId !== null) entry.employeeId = Number(r.employeeId);
        return entry;
      });
    },

    async getDirectory() {
      const raw = await client.get<{ employees?: Raw[] }>("/employees/directory");
      return (raw.employees ?? []).map((e) => {
        const emp: DirectoryEmployee = { id: Number(e.id) };
        for (const f of DIRECTORY_FIELDS) {
          const v = str(e[f]);
          if (v !== undefined) emp[f] = v;
        }
        return emp;
      });
    },

    async getTimeOffTypes() {
      const raw = await client.get<Raw>("/meta/time_off/types");
      return {
        timeOffTypes: (raw.timeOffTypes ?? []).map((t: Raw): TimeOffType => ({
          id: str(t.id) ?? "",
          name: str(t.name) ?? "",
          units: t.units,
        })),
        defaultHours: (raw.defaultHours ?? []).map((d: Raw) => ({ name: str(d.name) ?? "", amount: Number(d.amount) })),
      };
    },

    async getBalances(employeeId, asOf) {
      const raw = await client.get<Raw[]>(`/employees/${employeeId}/time_off/calculator`, { end: asOf });
      return raw.map((b) => ({
        timeOffTypeId: str(b.timeOffType) ?? "",
        name: str(b.name) ?? "",
        units: str(b.units) ?? "",
        balance: Number(b.balance),
        usedYearToDate: Number(b.usedYearToDate),
        policyType: str(b.policyType) ?? "",
        asOf: b.end ?? asOf,
      }));
    },

    async getTimeOffRequests(q) {
      const raw = await client.get<Raw[]>("/time_off/requests", {
        start: q.start,
        end: q.end,
        employeeId: q.employeeId,
        status: q.status?.length ? q.status.join(",") : undefined,
        type: q.typeIds?.length ? q.typeIds.join(",") : undefined,
      });
      return raw.map((r) => {
        const req: TimeOffRequest = {
          id: Number(r.id),
          employeeId: Number(r.employeeId),
          employeeName: str(r.name) ?? "",
          start: r.start,
          end: r.end,
          created: r.created,
          status: r.status?.status,
          typeId: str(r.type?.id) ?? "",
          typeName: str(r.type?.name) ?? "",
          amount: Number(r.amount?.amount ?? 0),
          unit: r.amount?.unit ?? "days",
        };
        if (r.notes && (r.notes.employee || r.notes.manager)) {
          req.notes = {};
          if (r.notes.employee) req.notes.employee = String(r.notes.employee);
          if (r.notes.manager) req.notes.manager = String(r.notes.manager);
        }
        return req;
      });
    },

    async getFields() {
      const raw = await client.get<Raw[]>("/meta/fields");
      return raw.map((f) => {
        const meta: FieldMeta = { id: String(f.id), name: str(f.name) ?? "", type: str(f.type) ?? "" };
        if (str(f.alias)) meta.alias = str(f.alias);
        if (f.deprecated) meta.deprecated = true;
        return meta;
      });
    },

    async getListFields() {
      const raw = await client.get<Raw[]>("/meta/lists");
      return raw.map((l): ListFieldMeta => {
        const list: ListFieldMeta = {
          listId: String(l.id),
          fieldId: String(l.fieldId),
          name: str(l.name) ?? "",
          manageable: yesNo(l.manageable),
          multiple: yesNo(l.multiple),
          options: (l.options ?? []).map((o: Raw) => ({ id: String(o.id), name: str(o.name) ?? String(o.value ?? ""), archived: yesNo(o.archived) })),
        };
        if (str(l.alias)) list.alias = str(l.alias);
        return list;
      });
    },

    async getTables() {
      const raw = await client.get<Raw[]>("/meta/tables");
      return raw.map((t): TableMeta => ({
        alias: str(t.alias) ?? "",
        fields: (t.fields ?? []).map((f: Raw) => {
          const col: TableMeta["fields"][number] = { id: String(f.id), name: str(f.name) ?? "", type: str(f.type) ?? "" };
          if (str(f.alias)) col.alias = str(f.alias);
          return col;
        }),
      }));
    },

    async getHolidays(start, end) {
      const out: Holiday[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        // Single-day holidays have a null endDate, and the filter grammar has no
        // `or`, so `endDate ge start` would drop them. Filter on startDate only,
        // with a year of look-back for multi-day holidays, and check overlap below.
        const raw = await client.get<{ data?: Raw[]; meta?: Raw }>("/holidays", {
          filter: `startDate le '${end}' and startDate ge '${addDays(start, -366)}'`,
          orderBy: "startDate asc",
          pageSize: 100,
          page,
        });
        for (const h of raw.data ?? []) {
          const endDate = h.endDate ?? h.startDate;
          if (endDate < start) continue;
          out.push({ id: Number(h.id), name: str(h.name) ?? "", startDate: h.startDate, endDate, isPublic: Boolean(h.isPublic) });
        }
        totalPages = Number(raw.meta?.totalPages ?? 1);
        page += 1;
      } while (page <= totalPages);
      return out;
    },

    async getUsers(status) {
      const raw = await client.get<Record<string, Raw>>("/meta/users", { status });
      return Object.values(raw).map((u): BambooUser => {
        const user: BambooUser = {
          userId: Number(u.id),
          firstName: str(u.firstName) ?? "",
          lastName: str(u.lastName) ?? "",
          status: str(u.status) ?? "",
        };
        // 0 means "no linked employee"; passed on, it would read as the key owner's own record.
        const employeeId = num(u.employeeId);
        if (employeeId !== undefined && employeeId > 0) user.employeeId = employeeId;
        // email is not passed on: BambooHR falls back to the home email when a user has no work email.
        if (str(u.lastLogin)) user.lastLogin = str(u.lastLogin);
        return user;
      });
    },
    async getEmployee(employeeId, fields) {
      const raw = await client.get<Raw>(`/employees/${employeeId}`, { fields: fields.join(","), onlyCurrent: true });
      return { id: Number(raw.id ?? employeeId), values: raw };
    },

    async runCustomReport(fields, employeeIds) {
      const body: Raw = { title: "bamboohr-mcp report", fields };
      if (employeeIds?.length) body.filters = { employeeIds };
      const raw = await client.post<Raw>("/reports/custom", body, { format: "JSON", onlyCurrent: true });
      return {
        fields: (raw.fields ?? []).map((f: Raw) => ({ id: String(f.id), type: str(f.type) ?? "", name: str(f.name) ?? "" })),
        employees: (raw.employees ?? []).map((e: Raw) => {
          const { id, ...rest } = e;
          return { id: Number(id), ...compact(rest) } as ReportRow;
        }),
      };
    },

    async getTableRows(table, employeeId) {
      const raw = await client.get<Raw[]>(`/employees/${employeeId}/tables/${encodeURIComponent(table)}`);
      return raw.map((r) => {
        const { id, employeeId: eid, ...rest } = r;
        return { id: Number(id), employeeId: Number(eid), ...compact(rest) } as TableRow;
      });
    },

    async getChangedEmployees(since, type) {
      const raw = await client.get<Raw>("/employees/changed", { since, type });
      const employees = Object.values<Raw>(raw.employees ?? {})
        .map((e): ChangedEmployee => ({ id: Number(e.id), action: e.action, lastChanged: e.lastChanged }))
        .sort((a, b) => (a.lastChanged < b.lastChanged ? 1 : a.lastChanged > b.lastChanged ? -1 : 0));
      return { latest: str(raw.latest) ?? "", employees };
    },

    async getTrainingTypes() {
      const raw = await client.get<Record<string, Raw> | Raw[]>("/training/type");
      return Object.values(raw).map((t): TrainingType => {
        const type: TrainingType = {
          id: Number(t.id),
          name: str(t.name) ?? "",
          required: truthy(t.required),
          renewable: truthy(t.renewable),
        };
        const category = str(t.category?.name);
        if (category) type.category = category;
        const freq = num(t.frequency);
        if (freq !== undefined) type.frequencyMonths = freq;
        const due = num(t.dueFromHireDate);
        if (due !== undefined) type.dueFromHireDateDays = due;
        const description = str(t.description);
        if (description) type.description = description;
        const linkUrl = str(t.linkUrl);
        if (linkUrl) type.linkUrl = linkUrl;
        return type;
      });
    },

    async getTrainingCategories() {
      const raw = await client.get<Record<string, Raw> | Raw[]>("/training/category");
      return Object.values(raw).map((c): TrainingCategory => ({ id: Number(c.id), name: str(c.name) ?? "" }));
    },

    async getTrainingRecords(employeeId, trainingTypeId) {
      const raw = await client.get<Record<string, Raw> | Raw[]>(`/training/record/employee/${employeeId}`, { type: trainingTypeId });
      return Object.values(raw).map((r): TrainingRecord => {
        const rec: TrainingRecord = { id: Number(r.id), trainingTypeId: Number(r.type), completed: str(r.completed) ?? "" };
        const instructor = str(r.instructor);
        if (instructor) rec.instructor = instructor;
        const hours = num(r.hours);
        if (hours !== undefined) rec.hours = hours;
        const credits = num(r.credits);
        if (credits !== undefined) rec.credits = credits;
        if (r.cost && str(r.cost.amount)) rec.cost = { currency: str(r.cost.currency) ?? "", amount: String(r.cost.amount) };
        const notes = str(r.notes);
        if (notes) rec.notes = notes;
        return rec;
      });
    },

    async getDependents(employeeId) {
      const raw = await client.get<Raw>("/employeedependents", { employeeid: employeeId });
      const list: Raw[] = raw["Employee Dependents"] ?? raw.employeeDependents ?? (Array.isArray(raw) ? raw : []);
      return list.map((d) => {
        const { id, employeeId: eid, ...rest } = d;
        return { id: Number(id), employeeId: Number(eid), ...compact(rest) } as Dependent;
      });
    },

    async getEmployeeFiles(employeeId) {
      const raw = await client.get<Raw>(`/employees/${employeeId}/files/view`);
      return (raw.categories ?? []).map((c: Raw): FileCategory => ({
        id: Number(c.id),
        name: str(c.name) ?? "",
        files: (c.files ?? []).map((f: Raw): EmployeeFile => {
          const file: EmployeeFile = { id: Number(f.id), name: str(f.name) ?? "" };
          const originalFileName = str(f.originalFileName);
          if (originalFileName) file.originalFileName = originalFileName;
          const size = num(f.size);
          if (size !== undefined) file.size = size;
          const dateCreated = str(f.dateCreated);
          if (dateCreated) file.dateCreated = dateCreated;
          const createdBy = str(f.createdBy);
          if (createdBy) file.createdBy = createdBy;
          if (f.shareWithEmployee !== undefined && f.shareWithEmployee !== null) file.shareWithEmployee = yesNo(f.shareWithEmployee);
          return file;
        }),
      }));
    },
  };
}
