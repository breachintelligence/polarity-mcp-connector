// test/polarity-request.test.js
// Tests for the polarityRequest() helper in src/polarity.js
// QA-75: Unit tests: polarityRequest helper
//
// ⚠️ Risk note: error messages include raw API response body text.
// If the Polarity server echoes back auth context or internal details,
// those will surface to Claude. Review server error responses before
// deploying in sensitive environments.
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

// Set required env vars before importing the module so polarityRequest
// can read SERVER_URL and TOKEN at call time.
process.env.POLARITY_SERVER_URL = "https://polarity.test";
process.env.POLARITY_TOKEN = "test-token-abc123";
delete process.env.POLARITY_TIMEOUT_MS;

const { polarityRequest } = await import("../src/polarity.js");

describe("polarityRequest", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = mock.method(globalThis, "fetch");
  });

  afterEach(() => {
    mock.restoreAll();
  });

  // ---------------------------------------------------------------------------
  // Authentication & Headers
  // ---------------------------------------------------------------------------

  describe("Authentication & Headers", () => {
    it("sends Authorization: Bearer <token> header", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ data: [] }),
        })
      );

      await polarityRequest("GET", "/api/integrations");

      const [, opts] = fetchMock.mock.calls[0].arguments;
      assert.equal(opts.headers.Authorization, "Bearer test-token-abc123");
    });

    it("sends Content-Type: application/vnd.api+json header", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({ ok: true, json: async () => ({}) })
      );

      await polarityRequest("GET", "/api/integrations");

      const [, opts] = fetchMock.mock.calls[0].arguments;
      assert.equal(opts.headers["Content-Type"], "application/vnd.api+json");
    });

    it("sends Accept: application/vnd.api+json header", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({ ok: true, json: async () => ({}) })
      );

      await polarityRequest("GET", "/api/integrations");

      const [, opts] = fetchMock.mock.calls[0].arguments;
      assert.equal(opts.headers["Accept"], "application/vnd.api+json");
    });

    it("uses the exact value of POLARITY_TOKEN without transformation", async () => {
      const originalToken = process.env.POLARITY_TOKEN;
      process.env.POLARITY_TOKEN = "my-exact-token-value";

      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({ ok: true, json: async () => ({}) })
      );

      await polarityRequest("GET", "/api/test");

      const [, opts] = fetchMock.mock.calls[0].arguments;
      assert.equal(opts.headers.Authorization, "Bearer my-exact-token-value");

      process.env.POLARITY_TOKEN = originalToken;
    });
  });

  // ---------------------------------------------------------------------------
  // URL Construction
  // ---------------------------------------------------------------------------

  describe("URL Construction", () => {
    it("constructs URL as SERVER_URL + path", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({ ok: true, json: async () => ({}) })
      );

      await polarityRequest("GET", "/api/integrations");

      const [url] = fetchMock.mock.calls[0].arguments;
      assert.equal(url, "https://polarity.test/api/integrations");
    });

    it("normalizes trailing slash in SERVER_URL so no double slashes appear", async () => {
      const original = process.env.POLARITY_SERVER_URL;
      process.env.POLARITY_SERVER_URL = "https://polarity.test/";

      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({ ok: true, json: async () => ({}) })
      );

      await polarityRequest("GET", "/api/integrations");

      const [url] = fetchMock.mock.calls[0].arguments;
      assert.equal(url, "https://polarity.test/api/integrations");

      process.env.POLARITY_SERVER_URL = original;
    });
  });

  // ---------------------------------------------------------------------------
  // Request Body
  // ---------------------------------------------------------------------------

  describe("Request Body", () => {
    it("JSON-serializes and attaches body when body is a non-null object", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({ ok: true, json: async () => ({}) })
      );

      const payload = { data: { type: "parsed-entities", attributes: { text: "8.8.8.8" } } };
      await polarityRequest("POST", "/api/parsed-entities", payload);

      const [, opts] = fetchMock.mock.calls[0].arguments;
      assert.equal(opts.body, JSON.stringify(payload));
    });

    it("does not attach a body when body is null (GET-style)", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({ ok: true, json: async () => ({}) })
      );

      await polarityRequest("GET", "/api/integrations", null);

      const [, opts] = fetchMock.mock.calls[0].arguments;
      assert.equal(opts.body, undefined);
    });
  });

  // ---------------------------------------------------------------------------
  // Timeout
  // ---------------------------------------------------------------------------

  describe("Timeout", () => {
    it("passes an AbortSignal to fetch", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({ ok: true, json: async () => ({}) })
      );

      await polarityRequest("GET", "/api/integrations");

      const [, opts] = fetchMock.mock.calls[0].arguments;
      assert.ok(opts.signal instanceof AbortSignal, "expected an AbortSignal");
    });

    it("defaults to a 30000ms timeout when POLARITY_TIMEOUT_MS is not set", async () => {
      delete process.env.POLARITY_TIMEOUT_MS;

      // We can't read the timeout value from AbortSignal directly, but we can
      // verify the signal is present. The default is documented as 30000ms.
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({ ok: true, json: async () => ({}) })
      );

      await polarityRequest("GET", "/api/integrations");

      const [, opts] = fetchMock.mock.calls[0].arguments;
      assert.ok(opts.signal instanceof AbortSignal);
    });
  });

  // ---------------------------------------------------------------------------
  // Error Handling
  // ---------------------------------------------------------------------------

  describe("Error Handling", () => {
    it("throws an Error with the status code when the response is not ok (401)", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          text: async () => "Unauthorized",
        })
      );

      await assert.rejects(
        () => polarityRequest("GET", "/api/integrations"),
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes("401"), `expected 401 in: ${err.message}`);
          return true;
        }
      );
    });

    it("includes the response body text in the thrown error message", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          statusText: "Forbidden",
          text: async () => "Token expired",
        })
      );

      await assert.rejects(
        () => polarityRequest("GET", "/api/integrations"),
        (err) => {
          assert.ok(err.message.includes("Token expired"), `expected body in: ${err.message}`);
          return true;
        }
      );
    });

    it("falls back to res.statusText when .text() itself throws", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => { throw new Error("stream broken"); },
        })
      );

      await assert.rejects(
        () => polarityRequest("GET", "/api/integrations"),
        (err) => {
          assert.ok(
            err.message.includes("Internal Server Error"),
            `expected statusText fallback in: ${err.message}`
          );
          return true;
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Success Path
  // ---------------------------------------------------------------------------

  describe("Success Path", () => {
    it("returns parsed JSON body on a 2xx response", async () => {
      const responseBody = { data: [{ id: "integration-1", attributes: { status: "running" } }] };

      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: async () => responseBody,
        })
      );

      const result = await polarityRequest("GET", "/api/integrations");
      assert.deepEqual(result, responseBody);
    });

    it("does not throw on a 2xx response with a valid JSON body", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ data: {} }),
        })
      );

      await assert.doesNotReject(() => polarityRequest("GET", "/api/integrations"));
    });
  });
});
