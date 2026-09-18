export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUTC(date: ISODate): Date {
  const m = ISO_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fromUTC(d: Date): ISODate {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

export function isISODate(value: string): boolean {
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return fromUTC(d) === value;
}

export function todayISO(now: Date = new Date()): ISODate {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const da = String(now.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = toUTC(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUTC(d);
}

export function daysInclusive(start: ISODate, end: ISODate): number {
  const ms = toUTC(end).getTime() - toUTC(start).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function yearOf(date: ISODate): number {
  return toUTC(date).getUTCFullYear();
}
