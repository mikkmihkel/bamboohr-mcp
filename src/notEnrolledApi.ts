import type { BambooHRApi } from "./bamboohr";

/**
 * Stand-in API used when no key is enrolled or the credential store cannot be
 * read: the MCP server still starts and still advertises its tools, so Claude
 * Desktop shows them and every call answers with the enrolment instructions
 * instead of the server being absent. Lives in its own module so tests can
 * import it without loading the bootstrap in index.ts.
 */
export function notEnrolledApi(error: Error): BambooHRApi {
  return new Proxy({} as BambooHRApi, {
    get: () => () => Promise.reject(error),
  });
}
