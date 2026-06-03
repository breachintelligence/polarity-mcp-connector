// test/version-consistency.test.js
// Tests that server.json version fields stay in sync with package.json
// QA-80: Unit tests: server.json / package.json version consistency
//
// This test is a release gate — it fails loudly if version fields drift.
// Consider adding to package.json scripts as "test:versions" for CI.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "../package.json"), "utf8")
);
const server = JSON.parse(
  readFileSync(resolve(__dirname, "../server.json"), "utf8")
);

describe("Version consistency: server.json vs package.json", () => {
  it("package.json version is a valid semver string (X.Y.Z)", () => {
    assert.match(
      pkg.version,
      /^\d+\.\d+\.\d+$/,
      `package.json version "${pkg.version}" is not a valid X.Y.Z semver`
    );
  });

  it("server.json top-level 'version' matches package.json 'version'", () => {
    assert.equal(
      server.version,
      pkg.version,
      `server.json version "${server.version}" !== package.json version "${pkg.version}"`
    );
  });

  it("server.json packages[0].version matches package.json 'version'", () => {
    const packageVersion = server.packages?.[0]?.version;
    assert.equal(
      packageVersion,
      pkg.version,
      `server.json packages[0].version "${packageVersion}" !== package.json version "${pkg.version}"`
    );
  });

  it("both server.json version fields are identical to each other", () => {
    const topLevel = server.version;
    const packageEntry = server.packages?.[0]?.version;
    assert.equal(
      topLevel,
      packageEntry,
      `server.json version fields differ: top-level "${topLevel}" !== packages[0].version "${packageEntry}"`
    );
  });
});
