import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("lineups section", () => {
  it("replaces the coming-soon placeholder with the static snapshot", async () => {
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
    assert.equal(html.includes("Coming soon"), false);
    assert.equal(html.includes("Not live data"), true);
  });

  it("uses the Season 4-only lineup sample", async () => {
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
    const section = html.slice(html.indexOf('id="lineups"'), html.indexOf('id="meta-report"'));
    const present = [
      "2,611 Season 4 matches involving top-20 players",
      "Sep 23 12:05 AM – Sep 24 2:36 PM PT",
      "2,663 different boards across 4,800 lineups",
      "most-used bot (Vigil) is in only 6.5%",
      "99.8% of lineups",
      "no active crew bonus won just 15.7% (108 lineups)",
      "61.3% overall, 62.2%",
      "4-11-2",
      "12 of 17 board-rounds",
      "52.7% of matches (1,376 of 2,611)",
    ];
    for (const text of present) {
      assert.equal(section.includes(text), true, `missing ${text}`);
    }
    const absent = ["3,235", "5,684", "3,045", "34.3%", "only 5.9%", "99.0%", "Sep 19", "1,545", "5-14-3", "14 of 22", "48%"];
    for (const text of absent) {
      assert.equal(section.includes(text), false, `stale mixed-season figure ${text}`);
    }
  });
});
