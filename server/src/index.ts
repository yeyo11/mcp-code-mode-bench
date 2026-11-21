#!/usr/bin/env node
// Mock google-docs-mcp over stdio. Usage: node dist/server/src/index.js [--padding N] [--seed S]
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

function intFlag(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const value = Number(process.argv[i + 1]);
  if (!Number.isInteger(value) || value < 0) {
    console.error(`${name} needs a non-negative integer`);
    process.exit(2);
  }
  return value;
}

const padding = intFlag("--padding", 0);
const seedArg = intFlag("--seed", -1);
const server = createServer({ padding, ...(seedArg >= 0 ? { seed: seedArg } : {}) });

// stdout is reserved for the MCP protocol: all logging goes to stderr.
await server.connect(new StdioServerTransport());
console.error(`${SERVER_NAME} ${SERVER_VERSION} ready (stdio, ${6 + padding} tools)`);
