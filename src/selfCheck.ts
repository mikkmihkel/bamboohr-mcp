/**
 * Start-up revocation check (task 10): a known-bad build of this server can be
 * stopped from starting without touching the machine it runs on. The request
 * carries no credentials and no identifying data — only the version — and it
 * goes to a static document over https.
 */
export interface RevocationDocument {
  schemaVersion: 1;
  revokedVersions?: string[];
  minimumVersion?: string;
  message?: string;
}

export type SelfCheckResult =
  | { status: "ok" }
  | { status: "revoked"; reason: string }
  | { status: "unavailable"; reason: string };

const DEFAULT_TIMEOUT_MS = 3000;

function parts(version: string): number[] {
  // Ignore any prerelease/build suffix: "4.0.0-rc.1" compares as 4.0.0.
  const core = version.trim().split(/[-+]/)[0] ?? "";
  const out = core.split(".").slice(0, 3).map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  while (out.length < 3) out.push(0);
  return out;
}

/** semver-ish major.minor.patch comparison; prerelease and build metadata are ignored. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i]! < right[i]!) return -1;
    if (left[i]! > right[i]!) return 1;
  }
  return 0;
}

export function evaluateRevocation(doc: RevocationDocument, version: string): SelfCheckResult {
  const suffix = doc.message ? ` ${doc.message}` : "";
  const revoked = doc.revokedVersions ?? [];
  if (revoked.some((v) => typeof v === "string" && compareVersions(v, version) === 0)) {
    return { status: "revoked", reason: `bamboohr-mcp ${version} has been revoked.${suffix}` };
  }
  if (doc.minimumVersion && compareVersions(version, doc.minimumVersion) < 0) {
    return {
      status: "revoked",
      reason: `bamboohr-mcp ${version} is below the minimum supported version ${doc.minimumVersion}.${suffix}`,
    };
  }
  return { status: "ok" };
}

function isDocument(value: unknown): value is RevocationDocument {
  return typeof value === "object" && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 1;
}

/**
 * Fetch the revocation document and evaluate it. Never sends the API key or any
 * other header beyond Accept and User-Agent, and gives up after `timeoutMs` so
 * a hanging endpoint cannot delay start-up.
 */
export async function runSelfCheck(
  url: string,
  version: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<SelfCheckResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Self-check URL is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Self-check URL must use https, got ${parsed.protocol}//`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(parsed.toString(), {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": `bamboohr-mcp/${version}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { status: "unavailable", reason: `revocation endpoint returned HTTP ${response.status}` };
    }
    let doc: unknown;
    try {
      doc = await response.json();
    } catch {
      return { status: "unavailable", reason: "revocation endpoint returned invalid JSON" };
    }
    if (!isDocument(doc)) {
      return { status: "unavailable", reason: "revocation document has an unexpected schema" };
    }
    return evaluateRevocation(doc, version);
  } catch (e) {
    const reason = (e as Error)?.name === "AbortError" ? `no answer within ${timeoutMs} ms` : (e as Error).message;
    return { status: "unavailable", reason: `revocation endpoint unreachable: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}
