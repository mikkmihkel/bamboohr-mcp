export interface Config {
  token: string;
  companyDomain: string;
  vacationType?: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const SUBDOMAIN_RE = /^[a-z0-9-]+$/i;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new ConfigError(`Missing required environment variable ${name}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = required(env, "BAMBOOHR_TOKEN");
  const companyDomain = required(env, "BAMBOOHR_COMPANY_DOMAIN");
  if (!SUBDOMAIN_RE.test(companyDomain)) {
    throw new ConfigError(
      `BAMBOOHR_COMPANY_DOMAIN must be the bare subdomain (e.g. "acme" for acme.bamboohr.com), got "${companyDomain}"`
    );
  }
  const vacationType = env.BAMBOOHR_VACATION_TYPE?.trim();
  const config: Config = { token, companyDomain };
  if (vacationType) config.vacationType = vacationType;
  return config;
}
