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
      "2,611 rated Season 4 matches involving top-20 players",
      "about 9,165 rated Season 4 matches as of Sep 24, 6:45 PM PT",
      "Sep 23 12:05 AM – Sep 24 2:36 PM PT",
      "4,800 top-20 lineup-games",
      "2,663 different boards across 4,800 lineup-games",
      "Vigil, is in 6.5% of those 4,800",
      "99.8% of 4,800 lineup-games",
      "15.7% (n=108)",
      "51.8% (n=4,258)",
      "36.0% without Fusion (n=542)",
      "Charmer Fusion (Personal + Sales): 61.3% (n=481) overall and 62.2% (n=296) without sodiumhyrdride, consistent across both views",
      "61.3% (n=481)",
      "62.2% (n=296)",
      "Top 5 of 17 by the lower of the two win rates",
      "Meeting Recap Deck 61.0% (n=159) / 61.8% (n=76)",
      "Foundry 62.0% (n=184) / 60.3% (n=63)",
      "Alchemist 64.2% (n=218) / 58.5% (n=106)",
      "X Hygiene 63.5% (n=159) / 66.3% (n=89)",
      "ideabot 71.2% (n=139) / 59.6% (n=52)",
      "Credit Card Max is not a winner: 46.6% (n=249)",
      "44.0% (n=100)",
      "65.9% (n=472)",
      "55.6% (n=223)",
      "61.2% (n=224)",
      "61.4% (n=140)",
      "17 of 5,222 Season 4 sides",
      "4-11-2",
      "12 of 17 board-rounds",
      "52.7% of these matches (1,376 of 2,611)",
    ];
    for (const text of present) {
      assert.equal(section.includes(text), true, `missing ${text}`);
    }
    const absent = ["3,235", "5,684", "3,045", "34.3%", "only 5.9%", "99.0%", "Sep 19", "1,545", "5-14-3", "14 of 22", "48%", "55%+", "61–62%", "Fusion only exists on Season 4 boards", "Best Fusion", "Most consistent", "best in both views", "5 of 17 shown", "Clip Bot"];
    for (const text of absent) {
      assert.equal(section.includes(text), false, `stale mixed-season figure ${text}`);
    }
  });
});
