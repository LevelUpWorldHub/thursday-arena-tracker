import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("lineups section", () => {
  it("replaces the coming-soon placeholder with the static snapshot", async () => {
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
    assert.equal(html.includes("Coming soon"), false);
    assert.equal(html.includes("Not live data"), true);
  });
});
