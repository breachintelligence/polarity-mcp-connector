#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
const SERVER_URL = process.env.POLARITY_SERVER_URL?.replace(/\/$/, "");
const TOKEN = process.env.POLARITY_TOKEN;
// Many self-hosted Polarity instances use self-signed certs
if (process.env.POLARITY_IGNORE_SSL === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

if (!SERVER_URL) {
  console.error("Error: POLARITY_SERVER_URL environment variable is required.");
  console.error("Example: https://polarity.yourcompany.com");
  process.exit(1);
}

if (!TOKEN) {
  console.error("Error: POLARITY_TOKEN environment variable is required.");
  console.error("Generate an API key in Polarity under Settings > API Keys.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "list_available_integrations",
    description:
      "Lists all running Polarity integrations accessible to the user, including their name, ID, acronym, version, description, and supported entity types. Call this first to discover which integrations are available before performing lookups.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "do_integration_lookup",
    description:
      "Performs a lookup against a specific Polarity integration. Parses entities (IP addresses, domains, hashes, URLs, etc.) from the query string, then queries the specified integration and returns enriched threat intelligence results.",
    inputSchema: {
      type: "object",
      properties: {
        integration_id: {
          type: "string",
          description:
            "The ID of the Polarity integration to query. Use list_available_integrations to retrieve valid integration IDs.",
        },
        query: {
          type: "string",
          description:
            "The text containing entities to look up (IP addresses, domains, file hashes, URLs, email addresses, etc.).",
        },
      },
      required: ["integration_id", "query"],
    },
  },
  {
    name: "parse_entities",
    description:
      "Parses and extracts entities such as IP addresses, domains, URLs, file hashes, and email addresses from the provided text. Returns typed entity objects with their values and positions.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description:
            "The text to scan for entities. Can be a log line, document snippet, or any free-form text.",
        },
      },
      required: ["text"],
    },
  },
];

// ---------------------------------------------------------------------------
// Polarity REST API helpers
// ---------------------------------------------------------------------------

async function polarityRequest(method, path, body = null) {
  const url = `${SERVER_URL}${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
    },
  };

  if (body) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Polarity API error ${res.status}: ${text}`);
  }

  return res.json();
}

async function listIntegrations() {
  const data = await polarityRequest("GET", "/api/integrations");
  return (data.data || []).filter(
    (i) => i.attributes?.status === "running"
  );
}

async function parseEntities(text) {
  const data = await polarityRequest("POST", "/api/parsed-entities", {
    data: { type: "parsed-entities", attributes: { text } },
  });
  return data.data?.attributes?.entities || [];
}

async function doLookup(integrationId, entities) {
  const data = await polarityRequest(
    "POST",
    `/api/integrations/${integrationId}/lookup`,
    {
      data: { type: "integrations", attributes: { entities } },
    }
  );
  return data.data?.attributes?.results || [];
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
      case "list_available_integrations": {
        const integrations = await listIntegrations();

        if (integrations.length === 0) {
          return {
            content: [
              { type: "text", text: "No running integrations found." },
            ],
          };
        }

        const lines = integrations.map((i) => {
          const a = i.attributes;
          const types =
            a.entityTypes?.length > 0 ? a.entityTypes.join(", ") : "N/A";
          return [
            `**${a.name}** (${a.acronym}) — ID: \`${i.id}\``,
            `  Version: ${a.version}`,
            `  Description: ${a.description || "No description provided."}`,
            `  Supported entity types: ${types}`,
          ].join("\n");
        });

        return {
          content: [
            {
              type: "text",
              text: `## Available Polarity Integrations (${integrations.length})\n\n${lines.join("\n\n")}`,
            },
          ],
        };
      }

      case "do_integration_lookup": {
        const { integration_id, query } = args;

        const entities = await parseEntities(query);

        if (entities.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No recognizable entities (IPs, domains, hashes, etc.) found in: "${query}"`,
              },
            ],
          };
        }

        const results = await doLookup(integration_id, entities);

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No results found in integration \`${integration_id}\` for: "${query}"`,
              },
            ],
          };
        }

        const lines = results.map((r) => {
          const entity = r.entity
            ? `${r.entity.type}: ${r.entity.value}`
            : r["display-value"] || "unknown";
          const data = r.data
            ? JSON.stringify(r.data, null, 2)
            : "No data returned.";
          return `### ${entity}\n\`\`\`json\n${data}\n\`\`\``;
        });

        return {
          content: [
            {
              type: "text",
              text: `## Lookup Results from \`${integration_id}\`\n\n${lines.join("\n\n")}`,
            },
          ],
        };
      }

      case "parse_entities": {
        const { text } = args;
        const entities = await parseEntities(text);

        if (entities.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No entities found in the provided text.",
              },
            ],
          };
        }

        const lines = entities.map(
          (e) =>
            `- **${e.type}**: \`${e.value}\`` +
            (e["display-value"] && e["display-value"] !== e.value
              ? ` (display: ${e["display-value"]})`
              : "")
        );

        return {
          content: [
            {
              type: "text",
              text: `## Parsed Entities (${entities.length})\n\n${lines.join("\n")}`,
            },
          ],
        };
      }

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
