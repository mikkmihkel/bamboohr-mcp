import type { ISODate } from "./dates";

export interface WhosOutEntry {
  id: number;
  type: "timeOff" | "holiday";
  employeeId?: number;
  name: string;
  start: ISODate;
  end: ISODate;
}

export interface DirectoryEmployee {
  id: number;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  department?: string;
  division?: string;
  location?: string;
  supervisor?: string;
  workEmail?: string;
}

export interface TimeOffType {
  id: string;
  name: string;
  units: "hours" | "days";
}

export interface TimeOffTypesResponse {
  timeOffTypes: TimeOffType[];
  defaultHours: { name: string; amount: number }[];
}

export interface TimeOffBalance {
  timeOffTypeId: string;
  name: string;
  units: string;
  balance: number;
  usedYearToDate: number;
  policyType: string;
  asOf: ISODate;
}

export type RequestStatus = "approved" | "denied" | "superceded" | "requested" | "canceled";

export interface TimeOffRequest {
  id: number;
  employeeId: number;
  employeeName: string;
  start: ISODate;
  end: ISODate;
  created: ISODate;
  status: RequestStatus;
  typeId: string;
  typeName: string;
  amount: number;
  unit: "hours" | "days";
  notes?: { employee?: string; manager?: string };
}

export interface ListOption {
  id: string;
  name: string;
  archived: boolean;
}

export interface FieldMeta {
  id: string;
  name: string;
  alias?: string;
  type: string;
  deprecated?: boolean;
  options?: ListOption[];
}

export interface ListFieldMeta {
  listId: string;
  fieldId: string;
  alias?: string;
  name: string;
  manageable: boolean;
  multiple: boolean;
  options: ListOption[];
}

export interface TableMeta {
  alias: string;
  fields: { id: string; name: string; alias?: string; type: string }[];
}

export type FieldValues = Record<string, string>;

export interface EmployeeRecord {
  id: number;
  fields: FieldValues;
  missingFields: string[];
}

export interface ReportRow {
  id: number;
  [field: string]: string | number;
}

export interface CustomReport {
  fields: { id: string; name: string; type: string }[];
  employees: ReportRow[];
}

export interface TableRow {
  id: number;
  employeeId: number;
  [column: string]: string | number;
}

export interface ChangedEmployee {
  id: number;
  action: "Inserted" | "Updated" | "Deleted";
  lastChanged: string;
}

export interface TrainingType {
  id: number;
  name: string;
  category?: string;
  required: boolean;
  renewable: boolean;
  frequencyMonths?: number;
  dueFromHireDateDays?: number;
  description?: string;
  linkUrl?: string;
}

export interface TrainingCategory {
  id: number;
  name: string;
}

export interface TrainingRecord {
  id: number;
  trainingTypeId: number;
  trainingTypeName?: string;
  completed: string;
  instructor?: string;
  hours?: number;
  credits?: number;
  cost?: { currency: string; amount: string };
  notes?: string;
}

export interface Dependent {
  id: number;
  employeeId: number;
  [key: string]: string | number;
}

export interface EmployeeFile {
  id: number;
  name: string;
  originalFileName?: string;
  size?: number;
  dateCreated?: string;
  createdBy?: string;
  shareWithEmployee?: boolean;
}

export interface FileCategory {
  id: number;
  name: string;
  files: EmployeeFile[];
}

export interface BambooUser {
  userId: number;
  employeeId?: number;
  firstName: string;
  lastName: string;
  email?: string;
  status: string;
  lastLogin?: string;
}

export interface Holiday {
  id: number;
  name: string;
  startDate: ISODate;
  endDate: ISODate;
  isPublic: boolean;
}
