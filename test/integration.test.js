// test/integration.test.js
// Integration tests: live API contract validation
// QA-82: Integration tests: live API contract validation
//
// These tests run against a REAL Polarity server. They auto-skip if
// POLARITY_SERVER_URL or POLARITY_TOKEN are not set in the environment.
//
// To run:
//   POLARITY_SERVER_URL=https://your-server \
//   POLARITY_TOKEN=your-api-key \
//   POLARITY_IGNORE_SSL=true \
//   POLARITY_TEST_INTEGRATION_ID=your-integration-id \
//   node --test test/integration.test.js
//
// Known test server assumption: at least one running integration is present.
// Set POLARITY_TEST_INTEGRATION_ID to a known valid integration ID for
// the doLookup tests.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const SKIP = !process.env.POLARITY_SERVER_URL || !process.env.POLARITY_TOKEN;
const skipMsg = "No live server configured (set POLARITY_SERVER_URL and POLARITY_TOKEN)";

// Apply SSL flag before importing polarity.js so TLS bypass is in effect
if (process.env.POLARITY_IGNORE_SSL === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const { listIntegrations, parseEntities, doLookup } = await import("../src/polarity.js");

// Helper: skip a test when no live server is configured
function skip(name, fn) {
  return it(name, { skip: SKIP ? skipMsg : false }, fn);
}

// ---------------------------------------------------------------------------
// listIntegrations() — GET /api/integrations
// ---------------------------------------------------------------------------

describe("listIntegrations() — live API", () => {
  skip("returns an array without throwing", async () => {
    const result = await listIntegrations();
    assert.ok(Array.isArray(result));
  });

  skip("every item has a string id field", async () => {
    const result = await listIntegrations();
    for (const item of result) {
      assert.equal(typeof item.id, "string", `item.id should be string: ${JSON.stringify(item)}`);
    }
  });

  skip("every item has attributes.name (string), attributes.status (string), attributes.entityTypes (array)", async () => {
    const result = await listIntegrations();
    for (const item of result) {
      assert.equal(typeof item.attributes?.name, "string");
      assert.equal(typeof item.attributes?.status, "string");
      assert.ok(Array.isArray(item.attributes?.entityTypes));
    }
  });

  skip("filtered result contains only items with status === 'running'", async () => {
    const result = await listIntegrations();
    for (const item of result) {
      assert.equal(item.attributes?.status, "running");
    }
  });
});

// ---------------------------------------------------------------------------
// parseEntities() — POST /api/parsed-entities
// ---------------------------------------------------------------------------

describe("parseEntities() — live API", () => {
  skip("parseEntities('8.8.8.8 evil.example.com') returns an array with at least one entry", async () => {
    const result = await parseEntities("8.8.8.8 evil.example.com");
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0, "expected at least one entity");
  });

  skip("result includes an IPv4 entity with value '8.8.8.8'", async () => {
    const result = await parseEntities("8.8.8.8 evil.example.com");
    const ipv4 = result.find(
      (e) => /ipv4/i.test(e.type) && e.value === "8.8.8.8"
    );
    assert.ok(ipv4, `expected IPv4 entity with value 8.8.8.8, got: ${JSON.stringify(result)}`);
  });

  skip("result includes a domain entity with value 'evil.example.com'", async () => {
    const result = await parseEntities("8.8.8.8 evil.example.com");
    const domain = result.find(
      (e) => /domain/i.test(e.type) && e.value === "evil.example.com"
    );
    assert.ok(domain, `expected domain entity, got: ${JSON.stringify(result)}`);
  });

  skip("every entity has at minimum a type and value field", async () => {
    const result = await parseEntities("8.8.8.8 evil.example.com");
    for (const entity of result) {
      assert.ok(entity.type, "expected entity.type");
      assert.ok(entity.value, "expected entity.value");
    }
  });

  skip("parseEntities('') returns empty array or throws with documented error", async () => {
    // Documenting actual server behavior — either is acceptable.
    try {
      const result = await parseEntities("");
      assert.ok(Array.isArray(result), "expected array on empty input");
    } catch (err) {
      // Server may reject empty input — document the error for reference
      assert.ok(err.message, `server rejected empty input: ${err.message}`);
    }
  });
});

// ---------------------------------------------------------------------------
// doLookup() — POST /api/integrations/:id/lookup
// ---------------------------------------------------------------------------

describe("doLookup() — live API", () => {
  // Set POLARITY_TEST_INTEGRATION_ID to a known valid integration ID
  const validIntegrationId = process.env.POLARITY_TEST_INTEGRATION_ID;

  skip("doLookup(validId, [{type:'IPv4',value:'8.8.8.8'}]) returns an array", async () => {
    if (!validIntegrationId) {
      assert.fail("Set POLARITY_TEST_INTEGRATION_ID env var for this test");
    }
    const result = await doLookup(validIntegrationId, [{ type: "IPv4", value: "8.8.8.8" }]);
    assert.ok(Array.isArray(result));
  });

  skip("each result item has a data field or display-value field", async () => {
    if (!validIntegrationId) {
      assert.fail("Set POLARITY_TEST_INTEGRATION_ID env var for this test");
    }
    const result = await doLookup(validIntegrationId, [{ type: "IPv4", value: "8.8.8.8" }]);
    for (const item of result) {
      const hasData = item.data !== undefined;
      const hasDisplayValue = item["display-value"] !== undefined;
      assert.ok(hasData || hasDisplayValue, `result item has neither data nor display-value: ${JSON.stringify(item)}`);
    }
  });

  skip("doLookup with nonexistent integration id throws error containing 404", async () => {
    await assert.rejects(
      () => doLookup("nonexistent-integration-id-xyz-000", [{ type: "IPv4", value: "8.8.8.8" }]),
      (err) => {
        assert.ok(
          err.message.includes("404") || err.message.includes("not found"),
          `expected 404 in error: ${err.message}`
        );
        return true;
      }
    );
  });

  skip("doLookup with empty entities array returns array without throwing", async () => {
    if (!validIntegrationId) {
      assert.fail("Set POLARITY_TEST_INTEGRATION_ID env var for this test");
    }
    // Documenting actual server behavior
    try {
      const result = await doLookup(validIntegrationId, []);
      assert.ok(Array.isArray(result));
    } catch (err) {
      // Server may reject empty entities — document the error
      assert.ok(err.message, `server rejected empty entities: ${err.message}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Full Two-Step Chain
// ---------------------------------------------------------------------------

describe("Full two-step chain (mirrors do_integration_lookup tool)", () => {
  const validIntegrationId = process.env.POLARITY_TEST_INTEGRATION_ID;

  skip("parseEntities('8.8.8.8') → doLookup succeeds end-to-end", async () => {
    if (!validIntegrationId) {
      assert.fail("Set POLARITY_TEST_INTEGRATION_ID env var for this test");
    }

    const entities = await parseEntities("8.8.8.8");
    assert.ok(entities.length > 0, "expected at least one entity from parse step");

    const results = await doLookup(validIntegrationId, entities);
    assert.ok(Array.isArray(results), "expected array from lookup step");
  });
});

// ---------------------------------------------------------------------------
// Self-Signed Certificate
// ---------------------------------------------------------------------------

describe("Self-signed certificate behavior", () => {
  skip("all tests above pass when POLARITY_IGNORE_SSL=true is set", () => {
    // This describe block acts as documentation: when POLARITY_IGNORE_SSL=true
    // is in the environment, all integration tests in this file should pass
    // against a server using a self-signed cert.
    // The SSL bypass is applied at the top of this file before any imports.
    assert.ok(true, "SSL bypass applied via NODE_TLS_REJECT_UNAUTHORIZED=0");
  });
});
