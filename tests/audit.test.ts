import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createAuditLog, purgeOldEntries, readRecentEntries } from "../src/audit";
import type { AuditEntry } from "../src/audit";

const POSIX = process.platform !== "win32";
const tempRoots: string[] = [];

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bamboohr-audit-"));
  tempRoots.push(root);
  return root;
}

/** A temp root plus the two paths createAuditLog needs. logDir does not exist yet. */
function paths(): { root: string; logDir: string; saltFile: string } {
  const root = tempDir();
  return { root, logDir: path.join(root, "logs"), saltFile: path.join(root, "data", "audit-salt") };
}

function entry(p: Partial<AuditEntry> = {}): AuditEntry {
  return { ts: new Date("2026-09-20T10:00:00.000Z").toISOString(), tool: "get_employee", outcome: "ok", ...p };
}

function lines(file: string): string[] {
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l !== "");
}

function mode(target: string): number {
  return fs.statSync(target).mode & 0o777;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("createAuditLog permissions", () => {
  it.skipIf(!POSIX)("creates the log directory 0700 and the log file 0600", () => {
    const p = paths();
    const log = createAuditLog(p);
    log.write(entry());
    expect(mode(p.logDir)).toBe(0o700);
    expect(mode(log.file)).toBe(0o600);
    expect(mode(p.saltFile)).toBe(0o600);
  });

  it.skipIf(!POSIX)("tightens the mode of a pre-existing log file on append", () => {
    const p = paths();
    fs.mkdirSync(p.logDir, { recursive: true });
    const file = path.join(p.logDir, "audit.jsonl");
    fs.writeFileSync(file, "", { mode: 0o644 });
    fs.chmodSync(file, 0o644);
    createAuditLog(p).write(entry());
    expect(mode(file)).toBe(0o600);
  });
});

describe("hashEmployeeId", () => {
  it("persists the salt and hashes stably across instances", () => {
    const p = paths();
    const first = createAuditLog(p);
    const hash = first.hashEmployeeId(1234);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(fs.existsSync(p.saltFile)).toBe(true);
    const saltHex = fs.readFileSync(p.saltFile, "utf8").trim();
    expect(saltHex).toMatch(/^[0-9a-f]{64}$/);

    const second = createAuditLog(p);
    expect(second.hashEmployeeId(1234)).toBe(hash);
    expect(second.hashEmployeeId("1234")).toBe(hash);
    expect(second.hashEmployeeId(1235)).not.toBe(hash);
    expect(fs.readFileSync(p.saltFile, "utf8").trim()).toBe(saltHex);
  });

  it("produces a different hash under a different salt", () => {
    const a = paths();
    const b = paths();
    expect(createAuditLog(a).hashEmployeeId(7)).not.toBe(createAuditLog(b).hashEmployeeId(7));
  });

  it("never writes the raw id into the log", () => {
    const p = paths();
    const log = createAuditLog(p);
    log.write(entry({ employeeIds: [log.hashEmployeeId(4242)] }));
    expect(fs.readFileSync(log.file, "utf8")).not.toContain("4242");
  });
});

describe("whitelist guard", () => {
  it("drops properties that are not part of AuditEntry", () => {
    const p = paths();
    const log = createAuditLog(p);
    const leaky = {
      ...entry({ fields: ["displayName"], recordCount: 2, scrubbedKeys: 1, durationMs: 12 }),
      payRate: "4200 EUR",
      response: { employees: [{ ssn: "123-45-6789" }] },
      message: "Anna Tamm",
    } as unknown as AuditEntry;
    log.write(leaky);
    const raw = fs.readFileSync(log.file, "utf8");
    expect(raw).not.toContain("payRate");
    expect(raw).not.toContain("Anna Tamm");
    expect(raw).not.toContain("123-45-6789");
    const written = JSON.parse(lines(log.file)[0]) as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(
      ["durationMs", "fields", "outcome", "recordCount", "scrubbedKeys", "tool", "ts"]
    );
  });

  it("also filters entries coming back out of readRecentEntries", () => {
    const p = paths();
    fs.mkdirSync(p.logDir, { recursive: true });
    fs.writeFileSync(
      path.join(p.logDir, "audit.jsonl"),
      `${JSON.stringify({ ts: entry().ts, tool: "t", outcome: "ok", secret: "x" })}\n`
    );
    const [read] = readRecentEntries(p.logDir, 10);
    expect(read).toEqual({ ts: entry().ts, tool: "t", outcome: "ok" });
  });
});

describe("rotation", () => {
  it("rotates by size, keeps maxFiles files and drops the oldest", () => {
    const p = paths();
    const log = createAuditLog(p, { maxFileBytes: 120, maxFiles: 3 });
    for (let i = 0; i < 20; i += 1) log.write(entry({ tool: `tool_${i}` }));

    const names = fs.readdirSync(p.logDir).filter((n) => n.endsWith(".jsonl")).sort();
    expect(names).toEqual(["audit.1.jsonl", "audit.2.jsonl", "audit.jsonl"]);
    expect(fs.existsSync(path.join(p.logDir, "audit.3.jsonl"))).toBe(false);

    const all = names.map((n) => fs.readFileSync(path.join(p.logDir, n), "utf8")).join("");
    expect(all).not.toContain("tool_0\"");
    expect(all).toContain("tool_19");
    for (const name of names) expect(Buffer.byteLength(fs.readFileSync(path.join(p.logDir, name)))).toBeLessThanOrEqual(120);
  });

  it("keeps rotated files readable in newest-last order", () => {
    const p = paths();
    const log = createAuditLog(p, { maxFileBytes: 120, maxFiles: 5 });
    for (let i = 0; i < 4; i += 1) log.write(entry({ tool: `tool_${i}` }));
    expect(fs.existsSync(path.join(p.logDir, "audit.3.jsonl"))).toBe(true);
    const tools = readRecentEntries(p.logDir, 100).map((e) => e.tool);
    expect(tools).toEqual(["tool_0", "tool_1", "tool_2", "tool_3"]);
    expect(readRecentEntries(p.logDir, 2).map((e) => e.tool)).toEqual(["tool_2", "tool_3"]);
  });
});

describe("purgeOldEntries", () => {
  const now = new Date("2026-09-21T00:00:00.000Z");
  const old = new Date("2026-01-01T00:00:00.000Z").toISOString();
  const fresh = new Date("2026-09-20T00:00:00.000Z").toISOString();

  function seed(logDir: string): void {
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(
      path.join(logDir, "audit.jsonl"),
      `${JSON.stringify(entry({ ts: old, tool: "old" }))}\n${JSON.stringify(entry({ ts: fresh, tool: "new" }))}\n`
    );
    fs.writeFileSync(
      path.join(logDir, "audit.1.jsonl"),
      `${JSON.stringify(entry({ ts: old, tool: "old1" }))}\n${JSON.stringify(entry({ ts: old, tool: "old2" }))}\n`
    );
  }

  it("removes entries past the retention window and deletes empty rotated files", () => {
    const p = paths();
    seed(p.logDir);
    const result = purgeOldEntries(p.logDir, 90, now);
    expect(result).toEqual({ removedEntries: 3, removedFiles: 1 });
    expect(fs.existsSync(path.join(p.logDir, "audit.1.jsonl"))).toBe(false);
    expect(lines(path.join(p.logDir, "audit.jsonl")).map((l) => JSON.parse(l).tool)).toEqual(["new"]);
  });

  it("keeps the current file even when everything in it expires", () => {
    const p = paths();
    fs.mkdirSync(p.logDir, { recursive: true });
    fs.writeFileSync(path.join(p.logDir, "audit.jsonl"), `${JSON.stringify(entry({ ts: old }))}\n`);
    expect(purgeOldEntries(p.logDir, 90, now)).toEqual({ removedEntries: 1, removedFiles: 0 });
    expect(fs.existsSync(path.join(p.logDir, "audit.jsonl"))).toBe(true);
    expect(lines(path.join(p.logDir, "audit.jsonl"))).toEqual([]);
  });

  it("leaves everything alone when nothing has expired", () => {
    const p = paths();
    seed(p.logDir);
    expect(purgeOldEntries(p.logDir, 3650, now)).toEqual({ removedEntries: 0, removedFiles: 0 });
    expect(lines(path.join(p.logDir, "audit.1.jsonl"))).toHaveLength(2);
  });

  it("runs once at creation with the injected clock", () => {
    const p = paths();
    seed(p.logDir);
    createAuditLog(p, { retentionDays: 90, now: () => now });
    expect(fs.existsSync(path.join(p.logDir, "audit.1.jsonl"))).toBe(false);
    expect(readRecentEntries(p.logDir, 10).map((e) => e.tool)).toEqual(["new"]);
  });

  it("does nothing for a directory that does not exist", () => {
    expect(purgeOldEntries(path.join(tempDir(), "missing"), 90, now)).toEqual({ removedEntries: 0, removedFiles: 0 });
  });
});

describe("readRecentEntries", () => {
  it("returns entries newest last and honours the limit", () => {
    const p = paths();
    const log = createAuditLog(p);
    for (let i = 0; i < 5; i += 1) log.write(entry({ tool: `tool_${i}`, recordCount: i }));
    expect(readRecentEntries(p.logDir, 100).map((e) => e.tool))
      .toEqual(["tool_0", "tool_1", "tool_2", "tool_3", "tool_4"]);
    expect(readRecentEntries(p.logDir, 2).map((e) => e.tool)).toEqual(["tool_3", "tool_4"]);
    expect(readRecentEntries(p.logDir, 0)).toEqual([]);
  });

  it("skips malformed and partial lines", () => {
    const p = paths();
    const log = createAuditLog(p);
    log.write(entry({ tool: "first" }));
    fs.appendFileSync(log.file, "not json\n{\"ts\":\"2026-09-20T10:00:00.000Z\"\n[1,2,3]\n\n");
    log.write(entry({ tool: "second" }));
    expect(readRecentEntries(p.logDir, 10).map((e) => e.tool)).toEqual(["first", "second"]);
  });

  it("returns an empty list for a missing directory", () => {
    expect(readRecentEntries(path.join(tempDir(), "missing"), 10)).toEqual([]);
  });
});

describe("failure tolerance", () => {
  it("never throws when the log directory cannot be created or written", () => {
    const root = tempDir();
    const blocker = path.join(root, "blocker");
    fs.writeFileSync(blocker, "regular file");
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const log = createAuditLog(
      { logDir: path.join(blocker, "logs"), saltFile: path.join(blocker, "salt") },
      { maxFileBytes: 10, maxFiles: 2 }
    );
    expect(() => log.write(entry())).not.toThrow();
    expect(() => log.write(entry())).not.toThrow();
    expect(log.hashEmployeeId(1)).toMatch(/^[0-9a-f]{16}$/);
    expect(stderr.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe("cloud sync and backup exclusion", () => {
  it("writes CACHEDIR.TAG with the standard signature and an empty .nosync", () => {
    const p = paths();
    createAuditLog(p, { platform: "linux", exec: vi.fn() });
    const tag = fs.readFileSync(path.join(p.logDir, "CACHEDIR.TAG"), "utf8");
    expect(tag.split("\n")[0]).toBe("Signature: 8a477f597d28d172789f06886806bc55");
    expect(fs.readFileSync(path.join(p.logDir, ".nosync"), "utf8")).toBe("");
  });

  it("excludes the directory from Time Machine on darwin", () => {
    const p = paths();
    const exec = vi.fn();
    createAuditLog(p, { platform: "darwin", exec });
    expect(exec).toHaveBeenCalledWith("tmutil", ["addexclusion", p.logDir]);
    expect(exec.mock.calls.every((c) => c[0] !== "icacls")).toBe(true);
  });

  it("does not call tmutil on other platforms", () => {
    const exec = vi.fn();
    createAuditLog(paths(), { platform: "linux", exec });
    expect(exec).not.toHaveBeenCalled();
  });

  it("tightens the ACL with icacls on win32 only when the directory is created", () => {
    const p = paths();
    const exec = vi.fn();
    createAuditLog(p, { platform: "win32", exec });
    expect(exec).toHaveBeenCalledTimes(1);
    const [file, args] = exec.mock.calls[0];
    expect(file).toBe("icacls");
    expect(args[0]).toBe(p.logDir);
    expect(args).toContain("/inheritance:r");
    expect(args[args.length - 1]).toMatch(/:\(OI\)\(CI\)F$/);

    const again = vi.fn();
    createAuditLog(p, { platform: "win32", exec: again });
    expect(again).not.toHaveBeenCalled();
  });

  it("survives an exec that throws", () => {
    const exec = vi.fn(() => {
      throw new Error("ENOENT");
    });
    const p = paths();
    expect(() => createAuditLog(p, { platform: "darwin", exec })).not.toThrow();
    expect(fs.existsSync(path.join(p.logDir, "CACHEDIR.TAG"))).toBe(true);
  });
});
