import { z } from "zod";
import type { BambooHRApi } from "../bamboohr";
import { isISODate, type ISODate } from "../dates";
import { VacationTypeNotFoundError } from "../overview";

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
}

export function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

export async function run(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof VacationTypeNotFoundError) {
      return {
        isError: true as const,
        content: [{ type: "text" as const, text: JSON.stringify({ error: e.message, availableTypes: e.available }, null, 2) }],
      };
    }
    return fail(e);
  }
}

export function assertRange(start: ISODate, end: ISODate): void {
  if (end < start) throw new Error(`end (${end}) must not be before start (${start})`);
}
