// test/startup.test.js
// Tests for startup validation (env var guards) and SSL flag behavior
// QA-79: Unit tests: startup validation and SSL flag
//
// Missing-env-var tests spawn src/index.js as a child process to test
// actual process.exit() behavior. SSL flag tests call applySSLFlag()
// directly from src/polarity.js.
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(__dirname, "../src/index.js");

// Import applySSLFlag once — it reads process.env at call time, not module load
const { applySSLFlag } = await import("../src/polarity.js");

// ---------------------------------------------------------------------------
// Startup Exit Tests (child process)
// ---------------------------------------------------------------------------

describe("Startup validation (child process)", () => {
  it("exits with code 1 when POLARITY_SERVER_URL is absent", () => {
    const result = spawnSync(
      process.execPath,
      [INDEX_PATH],
      {
        env: { ...process.env, POLARITY_SERVER_URL: "", POLARITY_TOKEN: "some-token" },
        timeout: 5000,
      }
    );

    assert.equal(result.status, 1, "expected exit code 1");
  });

  it("writes a human-readable error and example URL to stderr when POLARITY_SERVER_URL is absent", () => {
    const result = spawnSync(
      process.execPath,
      [INDEX_PATH],
      {
        env: { ...process.env, POLARITY_SERVER_URL: "", POLARITY_TOKEN: "some-token" },
        timeout: 5000,
      }
    );

    const stderr = result.stderr.toString();
    assert.ok(stderr.includes("POLARITY_SERVER_URL"), `expected env var name in stderr: ${stderr}`);
    assert.ok(
      stderr.includes("https://"),
      `expected an example URL in stderr: ${stderr}`
    );
  });

  it("exits with code 1 when POLARITY_TOKEN is absent (but SERVER_URL is set)", () => {
    const result = spawnSync(
      process.execPath,
      [INDEX_PATH],
      {
        env: {
          ...process.env,
          POLARITY_SERVER_URL: "https://polarity.test",
          POLARITY_TOKEN: "",
        },
        timeout: 5000,
      }
    );

    assert.equal(result.status, 1, "expected exit code 1");
  });

  it("writes a message directing the user to generate an API key when POLARITY_TOKEN is absent", () => {
    const result = spawnSync(
      process.execPath,
      [INDEX_PATH],
      {
        env: {
          ...process.env,
          POLARITY_SERVER_URL: "https://polarity.test",
          POLARITY_TOKEN: "",
        },
        timeout: 5000,
      }
    );

    const stderr = result.stderr.toString();
    assert.ok(stderr.includes("POLARITY_TOKEN"), `expected env var name in stderr: ${stderr}`);
    assert.ok(
      stderr.includes("API"),
      `expected API key guidance in stderr: ${stderr}`
    );
  });
});

// ---------------------------------------------------------------------------
// URL Normalization Tests
// polarityRequest reads process.env.POLARITY_SERVER_URL at call time and
// applies .replace(/\/$/, '') inline. We verify that regex behavior here
// and confirm the constructed URL via a mocked fetch.
// ---------------------------------------------------------------------------

describe("URL Normalization", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = mock.method(globalThis, "fetch", () =>
      Promise.resolve({ ok: true, json: async () => ({}) })
    );
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("strips a single trailing slash from POLARITY_SERVER_URL at call time", async () => {
    process.env.POLARITY_SERVER_URL = "https://polarity.io/";
    process.env.POLARITY_TOKEN = "tok";

    const { polarityRequest } = await import("../src/polarity.js");
    await polarityRequest("GET", "/api/integrations");

    const [url] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, "https://polarity.io/api/integrations");
  });

  it("leaves a URL without a trailing slash unchanged", async () => {
    process.env.POLARITY_SERVER_URL = "https://polarity.io";
    process.env.POLARITY_TOKEN = "tok";

    const { polarityRequest } = await import("../src/polarity.js");
    await polarityRequest("GET", "/api/integrations");

    const [url] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, "https://polarity.io/api/integrations");
  });

  it("only strips ONE trailing slash (known gap: /// → //) — replace(/\\/$/, '') removes one slash", () => {
    // The regex /\/$/ only removes the last slash.
    // This is a known gap documented here for future reference.
    // A future fix could use .replace(/\/+$/, '').
    const normalized = "https://polarity.io///".replace(/\/$/, "");
    assert.equal(normalized, "https://polarity.io//");
    // KNOWN GAP: multiple trailing slashes are not fully normalized.
  });
});

// ---------------------------------------------------------------------------
// SSL Flag Tests — calls applySSLFlag() directly from polarity.js
//
// ⚠️ SSL risk note: NODE_TLS_REJECT_UNAUTHORIZED=0 is process-level and
// affects ALL HTTPS connections, not just those to the Polarity server.
// This is intentional for self-hosted cert support but should ideally be
// scoped per-request using a custom https.Agent in a future improvement.
// ---------------------------------------------------------------------------

describe("SSL Flag Behavior", () => {
  let savedTLS;
  let savedIgnoreSSL;

  beforeEach(() => {
    savedTLS = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    savedIgnoreSSL = process.env.POLARITY_IGNORE_SSL;
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  });

  afterEach(() => {
    if (savedTLS === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = savedTLS;
    }
    if (savedIgnoreSSL === undefined) {
      delete process.env.POLARITY_IGNORE_SSL;
    } else {
      process.env.POLARITY_IGNORE_SSL = savedIgnoreSSL;
    }
  });

  it("does NOT set NODE_TLS_REJECT_UNAUTHORIZED when POLARITY_IGNORE_SSL is not set", () => {
    delete process.env.POLARITY_IGNORE_SSL;
    applySSLFlag();
    assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
  });

  it("does NOT set NODE_TLS_REJECT_UNAUTHORIZED when POLARITY_IGNORE_SSL=false", () => {
    process.env.POLARITY_IGNORE_SSL = "false";
    applySSLFlag();
    assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
  });

  it("sets NODE_TLS_REJECT_UNAUTHORIZED=0 when POLARITY_IGNORE_SSL=true", () => {
    process.env.POLARITY_IGNORE_SSL = "true";
    applySSLFlag();
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
  });

  it("does NOT set NODE_TLS_REJECT_UNAUTHORIZED when POLARITY_IGNORE_SSL=TRUE (uppercase)", () => {
    // Strict === "true" comparison — uppercase "TRUE" is not supported.
    // This is the documented behavior.
    process.env.POLARITY_IGNORE_SSL = "TRUE";
    applySSLFlag();
    assert.notEqual(
      process.env.NODE_TLS_REJECT_UNAUTHORIZED,
      "0",
      "POLARITY_IGNORE_SSL=TRUE (uppercase) should not trigger SSL bypass"
    );
  });
});
