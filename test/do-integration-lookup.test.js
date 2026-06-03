// test/do-integration-lookup.test.js
// Tests for handleDoIntegrationLookup() in src/polarity.js
// QA-77: Unit tests: do_integration_lookup handler
//
// Because polarity.js is an ESM module, named exports are live read-only
// bindings and cannot be stubbed via mock.method(). We control behavior
// by mocking globalThis.fetch with shaped responses. Each test controls
// the fetch sequence: first call → parseEntities response,
// second call → doLookup response.
//
// ⚠️ Risk note: The two-step chain (parseEntities → doLookup) has a single
// try/catch around both steps. A step-2 failure provides no info about
// whether step 1 succeeded or what entities were found. A future improvement
// should surface partial results (entities parsed but lookup failed) for
// better UX.
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

process.env.POLARITY_SERVER_URL = "https://polarity.test";
process.env.POLARITY_TOKEN = "test-token";

const { handleDoIntegrationLookup } = await import("../src/polarity.js");

// ---------------------------------------------------------------------------
// Fetch response helpers
// ---------------------------------------------------------------------------

function parsedEntitiesResponse(entities) {
  return {
    ok: true,
    json: async () => ({
      data: { attributes: { entities } },
    }),
  };
}

function lookupResponse(results) {
  return {
    ok: true,
    json: async () => ({
      data: { attributes: { results } },
    }),
  };
}

describe("handleDoIntegrationLookup", () => {
  let fetchMock;
  let callIndex;

  beforeEach(() => {
    callIndex = 0;
    fetchMock = mock.method(globalThis, "fetch");
  });

  afterEach(() => {
    mock.restoreAll();
  });

  // Sets up fetch to return parseResponse on the first call, lookupResponse on the second
  function mockTwoStep(parseResponse, lookupRespObj) {
    fetchMock.mock.mockImplementation(() => {
      const idx = callIndex++;
      if (idx === 0) return Promise.resolve(parseResponse);
      return Promise.resolve(lookupRespObj);
    });
  }

  // ---------------------------------------------------------------------------
  // Happy Path
  // ---------------------------------------------------------------------------

  describe("Happy Path", () => {
    it("returns formatted markdown when parseEntities and doLookup both succeed", async () => {
      mockTwoStep(
        parsedEntitiesResponse([{ type: "IPv4", value: "8.8.8.8" }]),
        lookupResponse([{ entity: { type: "IPv4", value: "8.8.8.8" }, data: { risk: "low" } }])
      );

      const result = await handleDoIntegrationLookup("vt-id", "check 8.8.8.8");
      assert.ok(!result.isError);
      assert.ok(result.content[0].text.includes("Lookup Results from"));
    });

    it("response header is '## Lookup Results from `{integration_id}`'", async () => {
      mockTwoStep(
        parsedEntitiesResponse([{ type: "IPv4", value: "1.1.1.1" }]),
        lookupResponse([{ entity: { type: "IPv4", value: "1.1.1.1" }, data: {} }])
      );

      const result = await handleDoIntegrationLookup("my-integration", "1.1.1.1");
      assert.ok(result.content[0].text.startsWith("## Lookup Results from `my-integration`"));
    });

    it("formats each result as '### {type}: {value}' heading with JSON code block", async () => {
      mockTwoStep(
        parsedEntitiesResponse([{ type: "domain", value: "evil.com" }]),
        lookupResponse([{ entity: { type: "domain", value: "evil.com" }, data: { threat: true } }])
      );

      const result = await handleDoIntegrationLookup("int-1", "evil.com");
      const text = result.content[0].text;
      assert.ok(text.includes("### domain: evil.com"));
      assert.ok(text.includes("```json"));
      assert.ok(text.includes('"threat": true'));
    });

    it("falls back to result['display-value'] when result.entity is absent", async () => {
      mockTwoStep(
        parsedEntitiesResponse([{ type: "IPv4", value: "9.9.9.9" }]),
        lookupResponse([{ "display-value": "9.9.9.9 (Quad9)", data: { info: "public dns" } }])
      );

      const result = await handleDoIntegrationLookup("int-1", "9.9.9.9");
      assert.ok(result.content[0].text.includes("### 9.9.9.9 (Quad9)"));
    });

    it("falls back to 'unknown' when both result.entity and display-value are absent", async () => {
      mockTwoStep(
        parsedEntitiesResponse([{ type: "IPv4", value: "1.2.3.4" }]),
        lookupResponse([{ data: { note: "no entity field" } }])
      );

      const result = await handleDoIntegrationLookup("int-1", "1.2.3.4");
      assert.ok(result.content[0].text.includes("### unknown"));
    });

    it("shows 'No data returned.' in code block when result.data is absent/null", async () => {
      mockTwoStep(
        parsedEntitiesResponse([{ type: "IPv4", value: "5.5.5.5" }]),
        lookupResponse([{ entity: { type: "IPv4", value: "5.5.5.5" } }])
      );

      const result = await handleDoIntegrationLookup("int-1", "5.5.5.5");
      assert.ok(result.content[0].text.includes("No data returned."));
    });
  });

  // ---------------------------------------------------------------------------
  // Early Exit: No Entities Parsed
  // ---------------------------------------------------------------------------

  describe("Early Exit: No Entities Parsed", () => {
    it("does NOT make a second fetch call (doLookup) when parseEntities returns no entities", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve(parsedEntitiesResponse([]))
      );

      await handleDoIntegrationLookup("int-1", "no iocs here");
      assert.equal(fetchMock.mock.calls.length, 1, "only one fetch call expected (parse step only)");
    });

    it("response text includes the original query string", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve(parsedEntitiesResponse([]))
      );

      const result = await handleDoIntegrationLookup("int-1", "hello world");
      assert.ok(result.content[0].text.includes('"hello world"'));
    });

    it("response says no recognizable entities were found", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve(parsedEntitiesResponse([]))
      );

      const result = await handleDoIntegrationLookup("int-1", "nothing");
      assert.ok(result.content[0].text.includes("No recognizable entities"));
    });

    it("empty-entities response does NOT have isError: true", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve(parsedEntitiesResponse([]))
      );

      const result = await handleDoIntegrationLookup("int-1", "nothing");
      assert.ok(!result.isError);
    });
  });

  // ---------------------------------------------------------------------------
  // Early Exit: No Lookup Results
  // ---------------------------------------------------------------------------

  describe("Early Exit: No Lookup Results", () => {
    it("returns 'no results found' when doLookup returns empty array", async () => {
      mockTwoStep(
        parsedEntitiesResponse([{ type: "IPv4", value: "8.8.8.8" }]),
        lookupResponse([])
      );

      const result = await handleDoIntegrationLookup("my-int", "8.8.8.8");
      assert.ok(result.content[0].text.includes("No results found"));
    });

    it("response includes the integration_id in the no-results message", async () => {
      mockTwoStep(
        parsedEntitiesResponse([{ type: "IPv4", value: "8.8.8.8" }]),
        lookupResponse([])
      );

      const result = await handleDoIntegrationLookup("my-special-int", "8.8.8.8");
      assert.ok(result.content[0].text.includes("my-special-int"));
    });

    it("no-results response does NOT have isError: true", async () => {
      mockTwoStep(
        parsedEntitiesResponse([{ type: "IPv4", value: "8.8.8.8" }]),
        lookupResponse([])
      );

      const result = await handleDoIntegrationLookup("int-1", "8.8.8.8");
      assert.ok(!result.isError);
    });
  });

  // ---------------------------------------------------------------------------
  // Error Handling: Step 1 Failure
  //
  // Note: handleDoIntegrationLookup (and the other handler functions) do NOT
  // have their own try/catch — errors bubble up to the MCP request handler in
  // index.js, which wraps calls in try/catch and returns { isError: true }.
  // These tests verify error propagation (throws) and the error content.
  // ---------------------------------------------------------------------------

  describe("Error Handling: Step 1 Failure (parseEntities throws)", () => {
    it("throws when the parse step fails", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
          text: async () => "Service Unavailable",
        })
      );

      await assert.rejects(
        () => handleDoIntegrationLookup("int-1", "8.8.8.8"),
        (err) => {
          assert.ok(err instanceof Error);
          return true;
        }
      );
    });

    it("does NOT make a second fetch call (doLookup) when step 1 fails", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
          text: async () => "Service Unavailable",
        })
      );

      await assert.rejects(() => handleDoIntegrationLookup("int-1", "8.8.8.8"));
      assert.equal(fetchMock.mock.calls.length, 1, "only parse step should be called");
    });

    it("error message includes the API error details", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
          text: async () => "service is down",
        })
      );

      await assert.rejects(
        () => handleDoIntegrationLookup("int-1", "8.8.8.8"),
        (err) => {
          assert.ok(err.message.includes("service is down"), `expected detail in: ${err.message}`);
          return true;
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Error Handling: Step 2 Failure
  // ---------------------------------------------------------------------------

  describe("Error Handling: Step 2 Failure (doLookup throws)", () => {
    it("throws when the lookup step fails", async () => {
      fetchMock.mock.mockImplementation(() => {
        const idx = callIndex++;
        if (idx === 0) return Promise.resolve(parsedEntitiesResponse([{ type: "IPv4", value: "8.8.8.8" }]));
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: async () => "integration not found",
        });
      });

      await assert.rejects(
        () => handleDoIntegrationLookup("bad-int", "8.8.8.8"),
        (err) => {
          assert.ok(err instanceof Error);
          return true;
        }
      );
    });

    it("error message includes the doLookup error details", async () => {
      fetchMock.mock.mockImplementation(() => {
        const idx = callIndex++;
        if (idx === 0) return Promise.resolve(parsedEntitiesResponse([{ type: "IPv4", value: "8.8.8.8" }]));
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: async () => "lookup timed out",
        });
      });

      await assert.rejects(
        () => handleDoIntegrationLookup("bad-int", "8.8.8.8"),
        (err) => {
          assert.ok(err.message.includes("lookup timed out"), `expected detail in: ${err.message}`);
          return true;
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Input Passthrough
  // ---------------------------------------------------------------------------

  describe("Input Passthrough", () => {
    it("passes integration_id in the lookup URL", async () => {
      const integrationId = "exact-integration-id-xyz";
      mockTwoStep(
        parsedEntitiesResponse([{ type: "IPv4", value: "1.1.1.1" }]),
        lookupResponse([{ entity: { type: "IPv4", value: "1.1.1.1" }, data: {} }])
      );

      await handleDoIntegrationLookup(integrationId, "1.1.1.1");

      const lookupCall = fetchMock.mock.calls[1];
      const [url] = lookupCall.arguments;
      assert.ok(
        url.includes(`/api/integrations/${integrationId}/lookup`),
        `expected integration id in URL: ${url}`
      );
    });

    it("passes query text to the parsed-entities endpoint", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve(parsedEntitiesResponse([]))
      );

      await handleDoIntegrationLookup("int-1", "check this text please");

      const [, opts] = fetchMock.mock.calls[0].arguments;
      const body = JSON.parse(opts.body);
      assert.equal(body.data.attributes.text, "check this text please");
    });

    it("passes entities from parse step in the lookup request body", async () => {
      const entities = [
        { type: "IPv4", value: "8.8.8.8" },
        { type: "domain", value: "evil.com" },
      ];
      mockTwoStep(
        parsedEntitiesResponse(entities),
        lookupResponse([{ entity: entities[0], data: {} }])
      );

      await handleDoIntegrationLookup("int-1", "8.8.8.8 evil.com");

      const [, opts] = fetchMock.mock.calls[1].arguments;
      const body = JSON.parse(opts.body);
      assert.deepEqual(body.data.attributes.entities, entities);
    });
  });
});
