import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("reads required and optional variables", () => {
    const cfg = loadConfig({
      BAMBOOHR_TOKEN: "abc",
      BAMBOOHR_COMPANY_DOMAIN: "acme",
      BAMBOOHR_VACATION_TYPE: "Vacation",
    });
    expect(cfg).toEqual({ token: "abc", companyDomain: "acme", vacationType: "Vacation" });
  });

  it("omits vacationType when unset or blank", () => {
    const cfg = loadConfig({ BAMBOOHR_TOKEN: "abc", BAMBOOHR_COMPANY_DOMAIN: "x", BAMBOOHR_VACATION_TYPE: "  " });
    expect(cfg.vacationType).toBeUndefined();
  });

  it("names the missing variable", () => {
    expect(() => loadConfig({ BAMBOOHR_COMPANY_DOMAIN: "x" })).toThrow(ConfigError);
    expect(() => loadConfig({ BAMBOOHR_COMPANY_DOMAIN: "x" })).toThrow(/BAMBOOHR_TOKEN/);
    expect(() => loadConfig({ BAMBOOHR_TOKEN: "abc" })).toThrow(/BAMBOOHR_COMPANY_DOMAIN/);
  });

  it("rejects a domain that is not a bare subdomain", () => {
    expect(() => loadConfig({ BAMBOOHR_TOKEN: "abc", BAMBOOHR_COMPANY_DOMAIN: "acme.bamboohr.com" })).toThrow(/subdomain/);
    expect(() => loadConfig({ BAMBOOHR_TOKEN: "abc", BAMBOOHR_COMPANY_DOMAIN: "https://x" })).toThrow(/subdomain/);
  });
});
