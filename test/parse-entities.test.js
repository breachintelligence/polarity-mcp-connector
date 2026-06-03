// test/parse-entities.test.js
// Tests for handleParseEntities() in src/polarity.js
// QA-78: Unit tests: parse_entities handler
//
// Because polarity.js is an ESM module, named exports are live read-only
// bindings and cannot be stubbed via mock.method(). We control behavior
// by mocking globalThis.fetch with shaped responses.
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

process.env.POLARITY_SERVER_URL = "https://polarity.test";
process.env.POLARITY_TOKEN = "test-token";

const { handleParseEntities } = await import("../src/polarity.js");

// Helper: build a fetch response that returns the given entities
function entityFetchResponse(entities) {
  return {
    ok: true,
    json: async () => ({
      data: { attributes: { entities } },
    }),
  };
}

describe("handleParseEntities", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = mock.method(globalThis, "fetch");
  });

  afterEach(() => {
    mock.restoreAll();
  });

  // ---------------------------------------------------------------------------
  // Happy Path: Response Formatting
  // ---------------------------------------------------------------------------

  describe("Happy Path: Response Formatting", () => {
    it("formats entities as '- **{type}**: `{value}`' list items", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve(entityFetchResponse([
          { type: "IPv4", value: "8.8.8.8", "display-value": "8.8.8.8" },
        ]))
      );

      const result = await handleParseEntities("check 8.8.8.8");
      assert.ok(result.content[0].text.includes("- **IPv4**: `8.8.8.8`"));
    });

    it("omits display suffix when display-value equals value", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve(entityFetchResponse([
          { type: "IPv4", value: "8.8.8.8", "display-value": "8.8.8.8" },
        ]))
      );

      const result = await handleParseEntities("8.8.8.8");
      assert.ok(!result.content[0].text.includes("display:"));
    });

    it("appends display suffix when display-value differs from value", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve(entityFetchResponse([
          { type: "URL", value: "http://evil.com/path", "display-value": "evil.com/path" },
        ]))
      );

      const result = await handleParseEntities("http://evil.com/path");
      assert.ok(result.content[0].text.includes("(display: evil.com/path)"));
    });

    it("omits display suffix when display-value is absent/undefined", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve(entityFetchResponse([
          { type: "domain", value: "evil.example.com" },
        ]))
      );

      const result = await handleParseEntities("evil.example.com");
      assert.ok(!result.content[0].text.includes("display:"));
    });

    it("response header is '## Parsed Entities ({N})' with correct count", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve(entityFetchResponse([
          { type: "IPv4", value: "1.1.1.1" },
          { type: "domain", value: "example.com" },
          { type: "domain", value: "test.org" },
        ]))
      );

      const result = await handleParseEntities("1.1.1.1 example.com test.org");
      assert.ok(result.content[0].text.startsWith("## Parsed Entities (3)"));
    });

    it("renders multiple entities as separate list items joined by newlines", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve(entityFetchResponse([
          { type: "IPv4", value: "1.1.1.1" },
          { type: "domain", value: "evil.com" },
        ]))
      );

      const result = await handleParseEntities("1.1.1.1 evil.com");
      const text = result.content[0].text;
      assert.ok(text.includes("- **IPv4**: `1.1.1.1`"));
      assert.ok(text.includes("- **domain**: `evil.com`"));
    });
  });

  // ---------------------------------------------------------------------------
  // Empty State
  // ---------------------------------------------------------------------------

  describe("Empty State", () => {
    it("returns 'No entities found in the provided text.' when API returns no entities", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve(entityFetchResponse([]))
      );

      const result = await handleParseEntities("hello world");
      assert.equal(result.content[0].text, "No entities found in the provided text.");
    });

    it("empty state response does NOT have isError: true", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve(entityFetchResponse([]))
      );

      const result = await handleParseEntities("no iocs");
      assert.ok(!result.isError);
    });
  });

  // ---------------------------------------------------------------------------
  // Malformed API Response
  // ---------------------------------------------------------------------------

  describe("Malformed API Response", () => {
    it("handles response missing 'data' property (treated as empty)", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({ ok: true, json: async () => ({}) })
      );

      const result = await handleParseEntities("8.8.8.8");
      assert.equal(result.content[0].text, "No entities found in the provided text.");
    });

    it("handles response missing data.attributes (treated as empty)", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({ ok: true, json: async () => ({ data: {} }) })
      );

      const result = await handleParseEntities("8.8.8.8");
      assert.equal(result.content[0].text, "No entities found in the provided text.");
    });

    it("handles response missing data.attributes.entities (treated as empty)", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ data: { attributes: {} } }),
        })
      );

      const result = await handleParseEntities("8.8.8.8");
      assert.equal(result.content[0].text, "No entities found in the provided text.");
    });
  });

  // ---------------------------------------------------------------------------
  // Error Handling
  //
  // Note: handleParseEntities does NOT have its own try/catch — errors bubble
  // up to the MCP request handler in index.js. These tests verify propagation.
  // ---------------------------------------------------------------------------

  describe("Error Handling", () => {
    it("throws when the API call fails", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
          text: async () => "service unavailable",
        })
      );

      await assert.rejects(
        () => handleParseEntities("8.8.8.8"),
        (err) => {
          assert.ok(err instanceof Error);
          return true;
        }
      );
    });

    it("error message includes the API error details", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 408,
          statusText: "Request Timeout",
          text: async () => "timeout after 30000ms",
        })
      );

      await assert.rejects(
        () => handleParseEntities("8.8.8.8"),
        (err) => {
          assert.ok(err.message.includes("timeout after 30000ms"), `expected detail in: ${err.message}`);
          return true;
        }
      );
    });
  });
});
