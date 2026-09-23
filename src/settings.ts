import * as fs from "node:fs";
import * as path from "node:path";
import type { AppPaths } from "./appPaths";

/**
 * Non-secret configuration. The BambooHR API key is deliberately NOT part of
 * this interface: it is never written to a file in clear text, and the only
 * variable that may carry it is API_KEY_ENV in config.ts, which the server
 * copies straight into the OS credential store.
 */
export interface Settings {
  /** BambooHR subdomain: "acme" for acme.bamboohr.com. */
  companyDomain?: string;
  /** Name or id of the time-off type that counts as vacation. */
  vacationType?: string;
  /** Gates the tools that expose dependents and employee files. */
  enableSensitiveTools: boolean;
  /**
   * Custom-field aliases this install allows. Unset keeps the automatic rule (any custom field
   * that is not blocked by name or type); an empty array refuses every custom field.
   */
  allowedCustomFields?: string[];
  /** Per-call record cap, 1..500. */
  maxRecords: number;
  /** Where the start-up self-check looks for revoked versions. */
  revocationUrl?: string;
  /** true: serve no data when the self-check endpoint is unreachable. */
  strictSelfCheck: boolean;
}

export const DEFAULT_REVOCATION_URL =
  "https://raw.githubusercontent.com/mikkmihkel/bamboohr-mcp/main/revocations.json";

export const DEFAULT_MAX_RECORDS = 25;
export const MIN_MAX_RECORDS = 1;
export const MAX_MAX_RECORDS = 500;

/** Existing rule: the bare subdomain only, never a host name or a URL. */
export const SUBDOMAIN_RE = /^[a-z0-9-]+$/i;

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

/** Built-in defaults: sensitive tools off, the default record cap. */
export function defaultSettings(): Settings {
  return { enableSensitiveTools: false, maxRecords: DEFAULT_MAX_RECORDS, strictSelfCheck: false };
}

/**
 * `${user_config.x}` left as written. Claude Desktop substitutes the values it
 * collected in the install dialog, but a host that skips an optional field
 * would otherwise turn the placeholder itself into a setting.
 */
export function isUnsubstitutedPlaceholder(value: string): boolean {
  return /^\$\{[^}]*\}$/.test(value.trim());
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || isUnsubstitutedPlaceholder(trimmed)) return undefined;
  return trimmed;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const s = asString(value)?.toLowerCase();
  if (s === undefined) return undefined;
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return undefined;
}

/**
 * A list of custom-field aliases, from a JSON array or a comma-separated environment variable.
 * An explicitly empty value ("" or []) means "no custom fields at all", so it must survive as an
 * empty array rather than collapsing to undefined.
 */
function asAliasList(value: unknown): string[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : undefined;
  if (raw === undefined) return undefined;
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed !== "" && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function asRecordCap(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(asString(value));
  if (!Number.isInteger(n) || n < MIN_MAX_RECORDS || n > MAX_MAX_RECORDS) return undefined;
  return n;
}

function readFileSettings(configFile: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = fs.readFileSync(configFile, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new SettingsError(`Cannot read ${configFile}: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SettingsError(
      `${configFile} is not valid JSON. Fix or delete the file and run the enroll subcommand again.`
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SettingsError(`${configFile} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

/** Apply one layer (file values or env values) over the accumulated settings. Invalid values are ignored. */
function apply(into: Settings, layer: {
  companyDomain?: unknown;
  vacationType?: unknown;
  enableSensitiveTools?: unknown;
  allowedCustomFields?: unknown;
  maxRecords?: unknown;
  revocationUrl?: unknown;
  strictSelfCheck?: unknown;
}): void {
  const companyDomain = asString(layer.companyDomain);
  if (companyDomain !== undefined && SUBDOMAIN_RE.test(companyDomain)) into.companyDomain = companyDomain;
  const vacationType = asString(layer.vacationType);
  if (vacationType !== undefined) into.vacationType = vacationType;
  const enableSensitiveTools = asBoolean(layer.enableSensitiveTools);
  if (enableSensitiveTools !== undefined) into.enableSensitiveTools = enableSensitiveTools;
  const allowedCustomFields = asAliasList(layer.allowedCustomFields);
  if (allowedCustomFields !== undefined) into.allowedCustomFields = allowedCustomFields;
  const maxRecords = asRecordCap(layer.maxRecords);
  if (maxRecords !== undefined) into.maxRecords = maxRecords;
  // A non-https revocation URL is ignored, not honoured: the self-check would otherwise be
  // downgraded to plain http (or a file: URL) by anyone who can edit config.json or the
  // environment, and a revoked build would keep starting.
  const revocationUrl = asString(layer.revocationUrl);
  if (revocationUrl !== undefined && isHttpsUrl(revocationUrl)) into.revocationUrl = revocationUrl;
  const strictSelfCheck = asBoolean(layer.strictSelfCheck);
  if (strictSelfCheck !== undefined) into.strictSelfCheck = strictSelfCheck;
}

/**
 * Settings from config.json, then non-secret environment overrides on top. The
 * Claude Desktop install dialog supplies the first two of these. No key is read
 * here under any name: the one variable that may carry a key is handled in
 * config.ts, which never lets it reach a settings file.
 */
export function readSettings(paths: AppPaths, env: NodeJS.ProcessEnv = process.env): Settings {
  const settings = defaultSettings();
  apply(settings, readFileSettings(paths.configFile));
  apply(settings, {
    companyDomain: env.BAMBOOHR_COMPANY_DOMAIN,
    vacationType: env.BAMBOOHR_VACATION_TYPE,
    enableSensitiveTools: env.BAMBOOHR_ENABLE_SENSITIVE_TOOLS,
    allowedCustomFields: env.BAMBOOHR_ALLOWED_CUSTOM_FIELDS,
    maxRecords: env.BAMBOOHR_MAX_RECORDS,
    revocationUrl: env.BAMBOOHR_REVOCATION_URL,
    strictSelfCheck: env.BAMBOOHR_STRICT_SELF_CHECK,
  });
  if (settings.revocationUrl === undefined) settings.revocationUrl = DEFAULT_REVOCATION_URL;
  return settings;
}

/**
 * Merge `patch` into config.json and write it back with 0600 inside a 0700
 * directory, so another account on the machine cannot read which company this
 * install talks to. Merges against the file, never against environment
 * overrides, so an override cannot be baked into the file by accident.
 */
export function writeSettings(paths: AppPaths, patch: Partial<Settings>): void {
  if (patch.companyDomain !== undefined) {
    const domain = asString(patch.companyDomain);
    if (!domain || !SUBDOMAIN_RE.test(domain)) {
      throw new SettingsError(
        `companyDomain must be the bare subdomain (e.g. "acme" for acme.bamboohr.com), got "${patch.companyDomain}"`
      );
    }
  }
  if (patch.maxRecords !== undefined && asRecordCap(patch.maxRecords) === undefined) {
    throw new SettingsError(`maxRecords must be an integer between ${MIN_MAX_RECORDS} and ${MAX_MAX_RECORDS}`);
  }
  if (patch.revocationUrl !== undefined) {
    const url = asString(patch.revocationUrl);
    if (!url || !isHttpsUrl(url)) throw new SettingsError(`revocationUrl must be an https URL, got "${patch.revocationUrl}"`);
  }

  if (patch.allowedCustomFields !== undefined && !Array.isArray(patch.allowedCustomFields)) {
    throw new SettingsError("allowedCustomFields must be an array of custom field aliases");
  }

  const current = readFileSettings(paths.configFile);
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    merged[key] = typeof value === "string" ? value.trim() : value;
  }

  fs.mkdirSync(path.dirname(paths.configFile), { recursive: true, mode: DIR_MODE });
  // Write a temporary file and rename it over config.json: the server rewrites the file
  // on start-up, and an interrupted in-place write would leave it unreadable.
  const tmp = `${paths.configFile}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`, { mode: FILE_MODE });
    fs.renameSync(tmp, paths.configFile);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // nothing left to clean up
    }
    throw e;
  }
  try {
    fs.chmodSync(paths.configFile, FILE_MODE);
    fs.chmodSync(path.dirname(paths.configFile), DIR_MODE);
  } catch {
    // chmod is a no-op on Windows; never fail a write over it.
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
