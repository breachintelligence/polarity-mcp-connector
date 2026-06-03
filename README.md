# Polarity MCP Connector

Connect [Claude](https://claude.ai) to your self-hosted [Polarity](https://polarity.io) instance via the [Model Context Protocol](https://modelcontextprotocol.io).

Enables Claude to:
- Discover all running integrations on your Polarity server
- Parse indicators of compromise (IPs, domains, hashes, URLs) from any text
- Query integrations and return enriched threat intelligence results — in real time, inside a conversation

---

## Prerequisites

- A running Polarity server (v4.x or later)
- A Polarity user account with API key access
- Node.js ≥ 18

## Setup

### 1. Generate a Polarity API Key

In the Polarity web interface: **Settings → API Keys → Create API Key**

### 2. Configure Claude Desktop

Add the following to your `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "polarity": {
      "command": "npx",
      "args": ["-y", "@polarity/mcp-connector"],
      "env": {
        "POLARITY_SERVER_URL": "https://polarity.yourcompany.com",
        "POLARITY_TOKEN": "your-api-key-here"
      }
    }
  }
}
```

Restart Claude Desktop. You should see the Polarity tools appear in the tools panel.

---

## Available Tools

| Tool | Description |
|------|-------------|
| `list_available_integrations` | Discover all running integrations and their supported entity types |
| `do_integration_lookup` | Look up a query string against a specific integration |
| `parse_entities` | Extract typed IOCs (IP, domain, hash, URL, email) from text |

---

## Example Prompts

> "What Polarity integrations are available?"

> "Look up 8.8.8.8 using the VirusTotal integration."

> "Parse all the IP addresses and domains from this log line: `[2025-01-15] src=192.168.1.5 dst=185.220.101.42 host=evil.example.com`"

> "Check if malware.bazaar.abuse.ch is in any of my threat intel integrations."

---

## License

MIT
