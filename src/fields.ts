import type { FieldMeta, FieldValues, ListFieldMeta } from "./types";

export const DEFAULT_EMPLOYEE_FIELDS: readonly string[] = [
  "displayName", "firstName", "lastName", "preferredName", "jobTitle", "department", "division", "location",
  "supervisor", "supervisorEId", "hireDate", "originalHireDate", "terminationDate", "status", "employmentHistoryStatus",
  "workEmail", "workPhone", "mobilePhone", "employeeNumber", "dateOfBirth", "gender", "country", "city",
];

export const MAX_REPORT_FIELDS = 400;
export const REPORT_ALWAYS_FIELDS = ["id", "displayName", "status"] as const;

function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");
}

/** Drop empty values and stringify the rest. BambooHR returns strings; this keeps the contract uniform. */
export function compact(values: Record<string, unknown>): FieldValues {
  const out: FieldValues = {};
  for (const [k, v] of Object.entries(values)) {
    if (hasValue(v)) out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}

/** Requested keys that came back absent or empty. Tells Claude whether a field was hidden by permissions or mistyped. */
export function missingFields(requested: string[], present: Record<string, unknown>): string[] {
  return requested.filter((k) => !hasValue(present[k]));
}

export function mergeFieldOptions(fields: FieldMeta[], lists: ListFieldMeta[]): FieldMeta[] {
  const byFieldId = new Map(lists.map((l) => [l.fieldId, l.options]));
  return fields.map((f) => {
    const options = byFieldId.get(f.id);
    return options ? { ...f, options } : f;
  });
}

export function searchFields(fields: FieldMeta[], search?: string): FieldMeta[] {
  const q = search?.trim().toLowerCase();
  if (!q) return fields;
  return fields.filter((f) => f.name.toLowerCase().includes(q) || (f.alias?.toLowerCase().includes(q) ?? false));
}
