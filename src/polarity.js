// ---------------------------------------------------------------------------
// src/polarity.js — pure logic module, safe to import in tests
//
// This module exports all business logic: tool definitions, API helpers, and
// tool handler functions. It reads SERVER_URL, TOKEN, and TIMEOUT_MS from
// process.env at call time (not at module load time) so that tests can control
// environment variables without side effects on import.
//
// No process.exit(), no server.connect(), no side effects on import.
// ---------------------------------------------------------------------------
import { Agent } from "undici";

// Only alphanumeric, underscores, and hyphens — prevents path traversal
// e.g. blocks "../../../admin" or "foo/bar" style injection
const INTEGRATION_ID_RE = /^[a-zA-Z0-9_-]+$/;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const TOOLS = [
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

/**
 * Core fetch wrapper for all Polarity API calls.
 *
 * Reads SERVER_URL, TOKEN, and TIMEOUT_MS from process.env at call time.
 *
 * ⚠️ Risk note: error messages include raw API response body text. If the
 * server echoes back auth context or internal details, those will surface to
 * Claude. Review server error responses before deploying in sensitive
 * environments.
 *
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - API path (e.g. "/api/integrations")
 * @param {object|null} body - Request body, or null for no body
 */
export async function polarityRequest(method, path, body = null) {
  const serverUrl = process.env.POLARITY_SERVER_URL?.replace(/\/$/, "");
  const token = process.env.POLARITY_TOKEN;
  const timeoutMs = parseInt(process.env.POLARITY_TIMEOUT_MS || "30000", 10);

  const url = `${serverUrl}${path}`;
  const opts = {
    method,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
    },
  };

  // Per-request TLS bypass — scoped only to Polarity calls so other MCP servers
  // sharing the Claude Desktop process are not affected.
  if (process.env.POLARITY_IGNORE_SSL === "true") {
    opts.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }

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

export async function listIntegrations() {
  const data = await polarityRequest("GET", "/api/integrations");
  return (data.data || []).filter(
    (i) => i.attributes?.status === "running"
  );
}

export async function parseEntities(text) {
  const data = await polarityRequest("POST", "/api/parsed-entities", {
    data: { type: "parsed-entities", attributes: { text } },
  });
  return data.data?.attributes?.entities || [];
}

export async function doLookup(integrationId, entities) {
  if (!INTEGRATION_ID_RE.test(integrationId)) {
    throw new Error(
      `Invalid integration_id "${integrationId}": must contain only alphanumeric characters, underscores, and hyphens.`
    );
  }
  const data = await polarityRequest(
    "POST",
    `/api/integrations/${encodeURIComponent(integrationId)}/lookup`,
    {
      data: { type: "integrations", attributes: { entities } },
    }
  );
  return data.data?.attributes?.results || [];
}

// ---------------------------------------------------------------------------
// Tool handler functions (extracted from MCP switch block)
// ---------------------------------------------------------------------------

export async function handleListAvailableIntegrations() {
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

export async function handleDoIntegrationLookup(integration_id, query) {
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

export async function handleParseEntities(text) {
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

/**
 * No-op: SSL bypass is now handled per-request inside polarityRequest() via a
 * scoped undici Agent, so this function no longer sets the process-level
 * NODE_TLS_REJECT_UNAUTHORIZED variable. Kept as an export so existing callers
 * do not need an immediate update.
 */
export function applySSLFlag() {
  // intentional no-op — see polarityRequest() for the per-request implementation
}
