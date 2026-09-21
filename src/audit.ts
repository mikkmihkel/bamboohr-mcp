import { execFileSync } from "child_process";
import { createHmac, randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { toolPath } from "./credentialStore";

/**
 * Local-only audit log (JSON lines). This module never performs any network I/O: it writes to
 * a per-user directory with owner-only permissions, rotates by size and purges by age. It also
 * never derives anything from the data it is handed — it writes exactly the whitelisted fields
 * of the entry it is given, so field values, employee names and response bodies cannot leak
 * into the log even if a future caller passes them in.
 */

export interface AuditEntry {
  /** ISO 8601 UTC. */
  ts: string;
  tool: string;
  /** Requested field names/aliases only. */
  fields?: string[];
  /** Safe parameter values only (dates, statuses, table alias, booleans). Never names or search strings. */
  filters?: Record<string, string | number | boolean | string[]>;
  /** Hashed ids, see hashEmployeeId. */
  employeeIds?: string[];
  recordCount?: number;
  /** Keys removed by the scrub pass. */
  scrubbedKeys?: number;
  /** "rejected" = blocked by policy before any HTTP call. */
  outcome: "ok" | "error" | "rejected";
  /** Error class name and HTTP status only, e.g. "BambooHRApiError 403". Never the message text. */
  error?: string;
  durationMs?: number;
}

export interface AuditLog {
  readonly dir: string;
  /** Current (unrotated) file path. */
  readonly file: string;
  /** Synchronous append. Never throws. */
  write(entry: AuditEntry): void;
  /** HMAC-SHA256(salt, String(id)) hex, first 16 chars. */
  hashEmployeeId(id: number | string): string;
}

/** Injected so the win32/darwin branches can be unit-tested without spawning anything. */
export type AuditExecFn = (file: string, args: string[]) => void;

export interface AuditOptions {
  /** Default 5 MiB. */
  maxFileBytes?: number;
  /** Default 5: audit.jsonl + audit.1.jsonl … audit.4.jsonl. */
  maxFiles?: number;
  /** Default 90. */
  retentionDays?: number;
  now?: () => Date;
  /** Test seam; defaults to process.platform. */
  platform?: NodeJS.Platform;
  /** Test seam; defaults to a best-effort execFileSync wrapper. */
  exec?: AuditExecFn;
}

export const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_FILES = 5;
export const DEFAULT_RETENTION_DAYS = 90;

const CURRENT_FILE = "audit.jsonl";
const FILE_RE = /^audit(?:\.(\d+))?\.jsonl$/;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const CACHEDIR_TAG = "Signature: 8a477f597d28d172789f06886806bc55\n" +
  "# This file is a cache directory tag created by bamboohr-mcp.\n" +
  "# For information about cache directory tags, see https://bford.info/cachedir/\n";

/** Entry properties that may be persisted. Anything else is dropped before the line is written. */
const ENTRY_KEYS = [
  "ts", "tool", "fields", "filters", "employeeIds", "recordCount", "scrubbedKeys", "outcome", "error", "durationMs",
] as const;

let warnedOnce = false;

function warnOnce(err: unknown): void {
  if (warnedOnce) return;
  warnedOnce = true;
  const reason = err instanceof Error ? err.name : "unknown error";
  process.stderr.write(`bamboohr-mcp: audit log is not writable (${reason}); continuing without an audit trail\n`);
}

function ignore(fn: () => void): void {
  try {
    fn();
  } catch {
    /* best effort only — never let housekeeping break the server */
  }
}

function defaultExec(file: string, args: string[]): void {
  execFileSync(file, args, { stdio: "ignore", timeout: 5000 });
}

/** Keep only the whitelisted properties, so a caller cannot accidentally persist a payload. */
function sanitizeEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ENTRY_KEYS) {
    const value = entry[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function rotatedName(index: number): string {
  return index === 0 ? CURRENT_FILE : `audit.${index}.jsonl`;
}

/** Audit files in the directory, newest first: audit.jsonl, audit.1.jsonl, … */
function listFilesNewestFirst(logDir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(logDir);
  } catch {
    return [];
  }
  const found: { index: number; name: string }[] = [];
  for (const name of names) {
    const m = FILE_RE.exec(name);
    if (m) found.push({ index: m[1] ? Number(m[1]) : 0, name });
  }
  found.sort((a, b) => a.index - b.index);
  return found.map((f) => path.join(logDir, f.name));
}

function chmodQuiet(target: string, mode: number, platform: NodeJS.Platform): void {
  if (platform === "win32") return; // chmod is a no-op on Windows; ACLs are set with icacls instead
  ignore(() => fs.chmodSync(target, mode));
}

function parseLine(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function ensureDir(logDir: string, platform: NodeJS.Platform, exec: AuditExecFn): void {
  const existed = fs.existsSync(logDir);
  if (!existed) fs.mkdirSync(logDir, { recursive: true, mode: DIR_MODE });
  chmodQuiet(logDir, DIR_MODE, platform);
  if (!existed && platform === "win32") {
    // chmod does nothing on Windows: strip inherited ACEs and grant the current user full control.
    const user = process.env.USERNAME ?? process.env.USER ?? "%USERNAME%";
    // Absolute path when it exists: an "icacls" earlier on PATH must not be the thing that gets
    // to decide the permissions of the audit directory.
    const root = process.env.SystemRoot?.trim() || "C:\\Windows";
    const icacls = toolPath([`${root}\\System32\\icacls.exe`], "icacls");
    ignore(() => exec(icacls, [logDir, "/inheritance:r", "/grant:r", `${user}:(OI)(CI)F`]));
  }
}

/** Best-effort: keep the log out of cloud sync clients and out of Time Machine backups. */
function markExcludedFromSync(logDir: string, platform: NodeJS.Platform, exec: AuditExecFn): void {
  ignore(() => {
    const tag = path.join(logDir, "CACHEDIR.TAG");
    if (!fs.existsSync(tag)) fs.writeFileSync(tag, CACHEDIR_TAG, { mode: FILE_MODE });
  });
  ignore(() => {
    const nosync = path.join(logDir, ".nosync");
    if (!fs.existsSync(nosync)) fs.writeFileSync(nosync, "", { mode: FILE_MODE });
  });
  if (platform === "darwin") ignore(() => exec(toolPath(["/usr/bin/tmutil"], "tmutil"), ["addexclusion", logDir]));
}

function loadSalt(saltFile: string, platform: NodeJS.Platform): Buffer {
  try {
    if (fs.existsSync(saltFile)) {
      const hex = fs.readFileSync(saltFile, "utf8").trim();
      if (/^[0-9a-f]{32,}$/i.test(hex)) return Buffer.from(hex, "hex");
    }
  } catch {
    /* fall through to a fresh salt */
  }
  const salt = randomBytes(32);
  ignore(() => {
    fs.mkdirSync(path.dirname(saltFile), { recursive: true, mode: DIR_MODE });
    fs.writeFileSync(saltFile, salt.toString("hex"), { mode: FILE_MODE });
    chmodQuiet(saltFile, FILE_MODE, platform);
  });
  return salt;
}

/**
 * Drop entries older than `retentionDays` from every audit file, and delete rotated files that
 * end up empty. Lines that do not parse, or that carry no usable `ts`, are dropped as well.
 */
export function purgeOldEntries(
  logDir: string,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
  now: Date = new Date()
): { removedEntries: number; removedFiles: number } {
  const result = { removedEntries: 0, removedFiles: 0 };
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  for (const file of listFilesNewestFirst(logDir)) {
    ignore(() => {
      const raw = fs.readFileSync(file, "utf8");
      const lines = raw.split("\n").filter((l) => l.trim() !== "");
      const kept: string[] = [];
      for (const line of lines) {
        const entry = parseLine(line);
        const ts = entry && typeof entry.ts === "string" ? Date.parse(entry.ts) : NaN;
        if (!Number.isNaN(ts) && ts >= cutoff) kept.push(line.trim());
        else result.removedEntries += 1;
      }
      if (kept.length === lines.length) return;
      if (kept.length === 0 && path.basename(file) !== CURRENT_FILE) {
        fs.unlinkSync(file);
        result.removedFiles += 1;
        return;
      }
      fs.writeFileSync(file, kept.length ? `${kept.join("\n")}\n` : "", { mode: FILE_MODE });
    });
  }
  return result;
}

/** Newest last, across rotated files. Malformed lines are skipped. */
export function readRecentEntries(logDir: string, limit: number): AuditEntry[] {
  if (limit <= 0) return [];
  const newestFirst: AuditEntry[] = [];
  for (const file of listFilesNewestFirst(logDir)) {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = raw.split("\n");
    for (let i = lines.length - 1; i >= 0 && newestFirst.length < limit; i -= 1) {
      const entry = parseLine(lines[i]);
      if (!entry || typeof entry.ts !== "string" || typeof entry.tool !== "string") continue;
      newestFirst.push(sanitizeEntry(entry) as unknown as AuditEntry);
    }
    if (newestFirst.length >= limit) break;
  }
  return newestFirst.reverse();
}

export function createAuditLog(paths: { logDir: string; saltFile: string }, options: AuditOptions = {}): AuditLog {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxFiles = Math.max(1, options.maxFiles ?? DEFAULT_MAX_FILES);
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const now = options.now ?? (() => new Date());
  const platform = options.platform ?? process.platform;
  const exec = options.exec ?? defaultExec;
  const dir = paths.logDir;
  const file = path.join(dir, CURRENT_FILE);

  ignore(() => ensureDir(dir, platform, exec));
  markExcludedFromSync(dir, platform, exec);
  const salt = loadSalt(paths.saltFile, platform);
  ignore(() => purgeOldEntries(dir, retentionDays, now()));

  function rotate(): void {
    // Drop the oldest, then shift every rotated file up by one and move the current file aside.
    ignore(() => fs.unlinkSync(path.join(dir, rotatedName(maxFiles - 1))));
    for (let i = maxFiles - 2; i >= 0; i -= 1) {
      const from = path.join(dir, rotatedName(i));
      const to = path.join(dir, rotatedName(i + 1));
      ignore(() => {
        if (fs.existsSync(from)) fs.renameSync(from, to);
      });
    }
  }

  function append(line: string): void {
    let existed = true;
    try {
      existed = fs.existsSync(file);
      const size = existed ? fs.statSync(file).size : 0;
      if (size > 0 && size + Buffer.byteLength(line) > maxFileBytes) {
        rotate();
        existed = false;
      }
    } catch {
      existed = false;
    }
    const fd = fs.openSync(file, "a", FILE_MODE);
    try {
      // openSync only applies `mode` when it creates the file; tighten pre-existing files too.
      if (existed && platform !== "win32") ignore(() => fs.fchmodSync(fd, FILE_MODE));
      fs.writeSync(fd, line);
    } finally {
      fs.closeSync(fd);
    }
  }

  return {
    dir,
    file,
    write(entry: AuditEntry): void {
      try {
        append(`${JSON.stringify(sanitizeEntry(entry as unknown as Record<string, unknown>))}\n`);
      } catch (err) {
        warnOnce(err);
      }
    },
    hashEmployeeId(id: number | string): string {
      return createHmac("sha256", salt).update(String(id)).digest("hex").slice(0, 16);
    },
  };
}
