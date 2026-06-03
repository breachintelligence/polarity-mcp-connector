// test/list-available-integrations.test.js
// Tests for handleListAvailableIntegrations() in src/polarity.js
// QA-76: Unit tests: list_available_integrations handler
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

process.env.POLARITY_SERVER_URL = "https://polarity.test";
process.env.POLARITY_TOKEN = "test-token";

const { handleListAvailableIntegrations, listIntegrations } = await import("../src/polarity.js");

// Helper: build a minimal running integration fixture
function makeIntegration(overrides = {}) {
  return {
    id: overrides.id ?? "int-1",
    attributes: {
      name: overrides.name ?? "VirusTotal",
      acronym: overrides.acronym ?? "VT",
      version: overrides.version ?? "2.0.0",
      description: overrides.description ?? "Scans files and URLs",
      status: overrides.status ?? "running",
      entityTypes: overrides.entityTypes ?? ["IPv4", "domain"],
      ...overrides.attributes,
    },
  };
}

describe("handleListAvailableIntegrations", () => {
  let fetchMock;

  // We mock fetch directly so we control what listIntegrations returns
  beforeEach(() => {
    fetchMock = mock.method(globalThis, "fetch");
  });

  afterEach(() => {
    mock.restoreAll();
  });

  function mockFetchWith(integrations) {
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ data: integrations }),
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  describe("Filtering", () => {
    it("excludes integrations with status !== 'running'", async () => {
      mockFetchWith([
        makeIntegration({ id: "int-1", status: "running" }),
        makeIntegration({ id: "int-2", status: "stopped" }),
        makeIntegration({ id: "int-3", status: "error" }),
        makeIntegration({ id: "int-4", status: "starting" }),
      ]);

      const result = await handleListAvailableIntegrations();
      assert.ok(result.content[0].text.includes("int-1"), "should include running");
      assert.ok(!result.content[0].text.includes("int-2"), "should exclude stopped");
      assert.ok(!result.content[0].text.includes("int-3"), "should exclude error");
      assert.ok(!result.content[0].text.includes("int-4"), "should exclude starting");
    });

    it("includes integrations with status === 'running'", async () => {
      mockFetchWith([makeIntegration({ id: "int-running", name: "Shodan", status: "running" })]);

      const result = await handleListAvailableIntegrations();
      assert.ok(result.content[0].text.includes("Shodan"));
    });

    it("returns only running integrations when API returns a mix", async () => {
      mockFetchWith([
        makeIntegration({ id: "a", name: "Alpha", status: "running" }),
        makeIntegration({ id: "b", name: "Beta", status: "stopped" }),
      ]);

      const result = await handleListAvailableIntegrations();
      assert.ok(result.content[0].text.includes("Alpha"));
      assert.ok(!result.content[0].text.includes("Beta"));
    });
  });

  // ---------------------------------------------------------------------------
  // Response Formatting
  // ---------------------------------------------------------------------------

  describe("Response Formatting", () => {
    it("includes name, acronym, and id in markdown format", async () => {
      mockFetchWith([makeIntegration({ id: "vt-id", name: "VirusTotal", acronym: "VT" })]);

      const result = await handleListAvailableIntegrations();
      const text = result.content[0].text;
      assert.ok(text.includes("**VirusTotal**"), "expected bold name");
      assert.ok(text.includes("(VT)"), "expected acronym");
      assert.ok(text.includes("`vt-id`"), "expected backtick-wrapped id");
    });

    it("includes Version line", async () => {
      mockFetchWith([makeIntegration({ version: "3.1.4" })]);

      const result = await handleListAvailableIntegrations();
      assert.ok(result.content[0].text.includes("Version: 3.1.4"));
    });

    it("includes Description line from attributes.description", async () => {
      mockFetchWith([makeIntegration({ description: "Threat intel lookup" })]);

      const result = await handleListAvailableIntegrations();
      assert.ok(result.content[0].text.includes("Description: Threat intel lookup"));
    });

    it("includes Supported entity types joined by ', '", async () => {
      mockFetchWith([makeIntegration({ entityTypes: ["IPv4", "domain", "hash"] })]);

      const result = await handleListAvailableIntegrations();
      assert.ok(result.content[0].text.includes("IPv4, domain, hash"));
    });

    it("separates multiple integrations with double newlines", async () => {
      mockFetchWith([
        makeIntegration({ id: "int-1", name: "Alpha" }),
        makeIntegration({ id: "int-2", name: "Beta" }),
      ]);

      const result = await handleListAvailableIntegrations();
      assert.ok(result.content[0].text.includes("\n\n"));
    });

    it("header includes the total count of integrations", async () => {
      mockFetchWith([
        makeIntegration({ id: "int-1" }),
        makeIntegration({ id: "int-2" }),
        makeIntegration({ id: "int-3" }),
      ]);

      const result = await handleListAvailableIntegrations();
      assert.ok(result.content[0].text.includes("(3)"), "expected count in header");
    });
  });

  // ---------------------------------------------------------------------------
  // Edge Cases
  // ---------------------------------------------------------------------------

  describe("Edge Cases", () => {
    it("shows 'N/A' for entity types when entityTypes is an empty array", async () => {
      mockFetchWith([makeIntegration({ entityTypes: [] })]);

      const result = await handleListAvailableIntegrations();
      assert.ok(result.content[0].text.includes("N/A"));
    });

    it("shows 'N/A' for entity types when entityTypes is missing/undefined", async () => {
      const integration = makeIntegration();
      delete integration.attributes.entityTypes;
      mockFetchWith([integration]);

      const result = await handleListAvailableIntegrations();
      assert.ok(result.content[0].text.includes("N/A"));
    });

    it("shows 'No description provided.' when description is missing/undefined", async () => {
      const integration = makeIntegration();
      delete integration.attributes.description;
      mockFetchWith([integration]);

      const result = await handleListAvailableIntegrations();
      assert.ok(result.content[0].text.includes("No description provided."));
    });

    it("shows 'No description provided.' when description is an empty string", async () => {
      mockFetchWith([makeIntegration({ description: "" })]);

      const result = await handleListAvailableIntegrations();
      // Empty string is falsy, so the || fallback applies
      assert.ok(result.content[0].text.includes("No description provided."));
    });
  });

  // ---------------------------------------------------------------------------
  // Empty State
  // ---------------------------------------------------------------------------

  describe("Empty State", () => {
    it("returns 'No running integrations found.' when API returns empty data array", async () => {
      mockFetchWith([]);

      const result = await handleListAvailableIntegrations();
      assert.equal(result.content[0].text, "No running integrations found.");
    });

    it("returns 'No running integrations found.' when all integrations are non-running", async () => {
      mockFetchWith([
        makeIntegration({ status: "stopped" }),
        makeIntegration({ status: "error" }),
      ]);

      const result = await handleListAvailableIntegrations();
      assert.equal(result.content[0].text, "No running integrations found.");
    });
  });

  // ---------------------------------------------------------------------------
  // Malformed API Response
  // ---------------------------------------------------------------------------

  describe("Malformed API Response", () => {
    it("handles missing 'data' property gracefully (treated as empty)", async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({ ok: true, json: async () => ({}) })
      );

      // Should not throw; should return empty state
      const result = await handleListAvailableIntegrations();
      assert.equal(result.content[0].text, "No running integrations found.");
    });

    it("handles individual integration missing 'attributes' gracefully", async () => {
      // An integration with no attributes object — optional chaining in listIntegrations
      // should filter it out (status check is i.attributes?.status === 'running' → undefined !== 'running')
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            data: [{ id: "bad-int" /* no attributes */ }],
          }),
        })
      );

      const result = await handleListAvailableIntegrations();
      // Should not throw — bad-int has no status, so it's filtered out as non-running
      assert.equal(result.content[0].text, "No running integrations found.");
    });
  });
});
