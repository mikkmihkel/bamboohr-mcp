import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAppPaths } from "../src/appPaths";

describe("resolveAppPaths", () => {
  it("uses LOCALAPPDATA on Windows", () => {
    const paths = resolveAppPaths({ LOCALAPPDATA: "C:\\Users\\anna\\AppData\\Local" }, "win32", "C:\\Users\\anna");
    expect(paths.dataDir).toBe(path.join("C:\\Users\\anna\\AppData\\Local", "bamboohr-mcp"));
    expect(paths.configFile).toBe(path.join(paths.dataDir, "config.json"));
    expect(paths.credentialFile).toBe(path.join(paths.dataDir, "credential.dpapi"));
  });

  it("falls back to AppData\\Local when LOCALAPPDATA is unset", () => {
    const paths = resolveAppPaths({}, "win32", "C:\\Users\\anna");
    expect(paths.dataDir).toBe(path.join("C:\\Users\\anna", "AppData", "Local", "bamboohr-mcp"));
  });

  it("splits data and logs on macOS", () => {
    const paths = resolveAppPaths({}, "darwin", "/Users/anna");
    expect(paths.dataDir).toBe("/Users/anna/Library/Application Support/bamboohr-mcp");
    expect(paths.logDir).toBe("/Users/anna/Library/Logs/bamboohr-mcp");
    expect(paths.saltFile).toBe("/Users/anna/Library/Application Support/bamboohr-mcp/audit-salt");
  });

  it("uses XDG_STATE_HOME on Linux, else ~/.local/state", () => {
    expect(resolveAppPaths({ XDG_STATE_HOME: "/home/anna/.state" }, "linux", "/home/anna").dataDir)
      .toBe("/home/anna/.state/bamboohr-mcp");
    const paths = resolveAppPaths({}, "linux", "/home/anna");
    expect(paths.dataDir).toBe("/home/anna/.local/state/bamboohr-mcp");
    expect(paths.logDir).toBe("/home/anna/.local/state/bamboohr-mcp/logs");
  });

  it("lets BAMBOOHR_MCP_DATA_DIR override every platform", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const paths = resolveAppPaths({ BAMBOOHR_MCP_DATA_DIR: "/tmp/bamboo-test" }, platform, "/home/anna");
      expect(paths.dataDir).toBe(path.resolve("/tmp/bamboo-test"));
      expect(paths.logDir).toBe(path.join(path.resolve("/tmp/bamboo-test"), "logs"));
    }
  });
});
