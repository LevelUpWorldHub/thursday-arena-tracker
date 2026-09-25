import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("lineups section", () => {
  it("replaces the coming-soon placeholder with the static snapshot", async () => {
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
    assert.equal(html.includes("Coming soon"), false);
    assert.equal(html.includes("3,235 rated Season 4 matches"), false);
    assert.equal(html.includes("2,611 Season 4"), true);
    assert.equal(html.includes("417 Season 3"), true);
    assert.equal(html.includes("207 Season 2"), true);
    assert.equal(html.includes("not Season 4 alone"), true);
    assert.equal(html.includes("Not live data"), true);
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    assert.equal(readme.includes("2,611 Season 4"), true);
    assert.equal(readme.includes("coming soon"), false);
  });
});
