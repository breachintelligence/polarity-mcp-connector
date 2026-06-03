#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  TOOLS,
  handleListAvailableIntegrations,
  handleDoIntegrationLookup,
  handleParseEntities,
} from "./polarity.js";

// SSL bypass for self-signed certs is handled per-request inside polarity.js

if (!process.env.POLARITY_SERVER_URL?.replace(/\/$/, "")) {
  console.error("Error: POLARITY_SERVER_URL environment variable is required.");
  console.error("Example: https://polarity.yourcompany.com");
  process.exit(1);
}

if (!process.env.POLARITY_TOKEN) {
  console.error("Error: POLARITY_TOKEN environment variable is required.");
  console.error("Generate an API key in Polarity under Settings > API Keys.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "polarity", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "list_available_integrations":
        return await handleListAvailableIntegrations();

      case "do_integration_lookup":
        return await handleDoIntegrationLookup(args.integration_id, args.query);

      case "parse_entities":
        return await handleParseEntities(args.text);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
