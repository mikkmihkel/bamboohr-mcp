#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBambooHRApi } from "./bamboohr";
import { createClient } from "./client";
import { ConfigError, loadConfig } from "./config";
import { createServer } from "./server";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`bamboohr-mcp: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }

  const api = createBambooHRApi(createClient(config));
  const server = createServer(api, { envVacationType: config.vacationType });
  await server.connect(new StdioServerTransport());
  console.error(`bamboohr-mcp: connected to ${config.companyDomain}.bamboohr.com over stdio`);
}

main().catch((error) => {
  console.error("bamboohr-mcp: fatal error", error);
  process.exit(1);
});
