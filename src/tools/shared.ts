import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { AuditEntry, AuditLog } from "../audit";
import type { BambooHRApi } from "../bamboohr";
import { BambooHRApiError } from "../client";
import { isISODate, type ISODate } from "../dates";
import { VacationTypeNotFoundError } from "../overview";
import {
  envelope,
  PolicyError,
  scrub,
  stripControlChars,
  wrapUntrustedText,
  type FieldLookup,
} from "../policy";
import type { Settings } from "../settings";
import type { TableMeta } from "../types";

export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const isoDate = z
  .string()
  .refine(isISODate, { message: "must be a date in YYYY-MM-DD format" });

export const positiveInt = z.number().int().positive();

export interface ToolContext {
  api: BambooHRApi;
  today: () => ISODate;
  envVacationType?: string;
  /** Resolved settings: the record cap and the sensitive-tool gate live here. */
  settings: Settings;
  /** Local audit trail. Never throws; a no-op log is used when none is configured. */
  audit: AuditLog;
  /** Field metadata behind a short TTL cache, shared by every tool. */
  fieldMeta: () => Promise<FieldLookup[]>;
  /** Table metadata behind the same cache, blocked tables already removed (columns are not). */
  tables: () => Promise<TableMeta[]>;
}

/**
 * Values that may be written to the audit log as call parameters. Dates, statuses, table
 * aliases, field names, organisational names (department/location/division), ids of
 * time-off types and booleans — never a search string, a person's name or a response value.
 */
export type SafeFilterValue = string | number | boolean | string[];

export interface ToolMeta {
  tool: string;
  /** Requested field names/aliases. */
  fields?: string[];
  /** Safe call parameters only; see SafeFilterValue. `search` must be passed as `true`, not the text. */
  filters?: Record<string, SafeFilterValue | undefined>;
  /** Raw ids; they are hashed before they reach the log. */
  employeeIds?: (number | string | undefined)[];
  /** How many records the result stands for; see countRecords for the default. */
  count?: (result: any) => number;
}

const COUNTABLE_ARRAY_KEYS = ["rows", "employees", "records", "dependents", "categories"] as const;

/** Best-effort record count for the audit log: a list length, never anything derived from values. */
function countRecords(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (result !== null && typeof result === "object") {
    for (const key of COUNTABLE_ARRAY_KEYS) {
      const value = (result as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value.length;
    }
  }
  return 1;
}

/** Longest filter value and field name the audit log will keep; the rest is a free-text risk. */
export const MAX_AUDIT_VALUE_LENGTH = 64;

function clip(value: string): string {
  return value.length > MAX_AUDIT_VALUE_LENGTH ? `${value.slice(0, MAX_AUDIT_VALUE_LENGTH)}…` : value;
}

/**
 * Audit values are truncated: the schemas keep free text out of the logged parameters, but a
 * long value would still be the one place a caller could park arbitrary text in the log file.
 */
function clipValue(value: SafeFilterValue): SafeFilterValue {
  if (typeof value === "string") return clip(value);
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? clip(v) : v));
  return value;
}

function safeFilters(filters: ToolMeta["filters"]): AuditEntry["filters"] | undefined {
  if (!filters) return undefined;
  const out: Record<string, SafeFilterValue> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    out[key] = clipValue(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 16 hex characters of fresh randomness: the tag that marks this call's data block. */
function newNonce(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Error classes whose message is our own text, usually an instruction the user must follow
 * (an enrolment command, a policy refusal). Those are NOT enveloped — the model should act on
 * them. Every other message may echo BambooHR-originated content and is fenced as data.
 */
const OWN_MESSAGE_ERRORS: ReadonlySet<string> = new Set([
  "PolicyError",
  "NotEnrolledError",
  "ConfigError",
  "CredentialStoreError",
  "SettingsError",
  "ZodError",
]);

function isOwnMessage(error: unknown): boolean {
  return error instanceof Error && OWN_MESSAGE_ERRORS.has(error.name);
}

/**
 * Error text for the model. Control characters are always stripped; text that can carry
 * BambooHR content goes through the same envelope as a successful payload, so a crafted field
 * name or API error message cannot reach the model as bare, unfenced text.
 */
function failText(text: string, nonce: string, own: boolean) {
  const clean = stripControlChars(text);
  return { isError: true as const, content: [{ type: "text" as const, text: own ? clean : envelope(clean, nonce) }] };
}

export function fail(error: unknown, nonce: string) {
  const message = error instanceof Error ? error.message : String(error);
  return failText(message, nonce, isOwnMessage(error));
}

/** The one place a BambooHR payload becomes text for the model: scrub, fence, envelope. */
function present(result: unknown, nonce: string): { text: string; scrubbedKeys: number } {
  const { value, removed } = scrub(result);
  const json = JSON.stringify(wrapUntrustedText(value), null, 2);
  return { text: envelope(json, nonce), scrubbedKeys: removed };
}

/**
 * The boundary every tool call passes through. It renders the result, writes exactly one
 * audit entry, and turns policy refusals and API failures into plain isError results so a
 * failed call never takes the server down.
 */
export async function run(ctx: ToolContext, meta: ToolMeta, fn: () => Promise<unknown>) {
  const started = Date.now();
  // One nonce per call: it tags this call's data block, whether the call succeeds or fails.
  const nonce = newNonce();

  const write = (entry: Omit<AuditEntry, "ts" | "tool" | "durationMs">): void => {
    const full: AuditEntry = {
      ts: new Date().toISOString(),
      tool: meta.tool,
      ...entry,
      durationMs: Date.now() - started,
    };
    if (meta.fields?.length) full.fields = meta.fields.map(clip);
    const filters = safeFilters(meta.filters);
    if (filters) full.filters = filters;
    const ids = (meta.employeeIds ?? []).filter((id): id is number | string => id !== undefined);
    if (ids.length > 0) full.employeeIds = ids.map((id) => ctx.audit.hashEmployeeId(id));
    ctx.audit.write(full);
  };

  try {
    const result = await fn();
    const { text, scrubbedKeys } = present(result, nonce);
    write({
      outcome: "ok",
      recordCount: meta.count ? meta.count(result) : countRecords(result),
      scrubbedKeys,
    });
    return { content: [{ type: "text" as const, text }] };
  } catch (e) {
    if (e instanceof PolicyError) {
      // "rejected" means the call was refused here, before any employee data was fetched.
      write({ outcome: "rejected", error: `PolicyError ${e.code}` });
      return fail(e, nonce);
    }
    if (e instanceof VacationTypeNotFoundError) {
      write({ outcome: "error", error: e.name });
      // The message and the type names in it come from BambooHR: fenced like any other payload.
      return failText(JSON.stringify({ error: e.message, availableTypes: e.available }, null, 2), nonce, false);
    }
    if (e instanceof BambooHRApiError) {
      write({ outcome: "error", error: `BambooHRApiError ${e.status}` });
      return fail(e, nonce);
    }
    // Everything else, including NotEnrolledError and credential-store failures: the message
    // carries the fix (e.g. the enrolment command), the log carries only the class name.
    write({ outcome: "error", error: e instanceof Error ? e.name : "Error" });
    return fail(e, nonce);
  }
}

export function assertRange(start: ISODate, end: ISODate): void {
  if (end < start) throw new Error(`end (${end}) must not be before start (${start})`);
}
