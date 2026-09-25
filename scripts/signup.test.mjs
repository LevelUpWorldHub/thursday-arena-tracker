import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const mailto =
  "mailto:thursdayarena@agentmail.to?subject=Subscribe%20to%20the%20weekly%20meta%20report&body=Please%20add%20me%20to%20the%20Thursday%20Arena%20weekly%20meta%20report.";

describe("weekly meta signup", () => {
  it("shows the heading, mailto address, and unsubscribe note", async () => {
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
    const rendered = html.replaceAll("&amp;", "&");
    const lineups = rendered.indexOf('id="lineups"');
    const signup = rendered.indexOf('id="meta-report"');
    const footer = rendered.indexOf("<footer");
    assert.ok(lineups >= 0 && signup > lineups && footer > signup);
    assert.equal(rendered.includes("Get the weekly meta report"), true);
    assert.equal(rendered.includes(mailto), true);
    assert.equal(rendered.includes("thursdayarena@agentmail.to"), true);
    assert.equal(rendered.includes("To unsubscribe anytime, email the same address with 'unsubscribe'."), true);
    assert.equal(
      rendered.includes(
        "Unofficial fan-made tracker. Not affiliated with or endorsed by Thursday Arena. Data from Thursday Arena's public API.",
      ),
      true,
    );
    assert.equal(rendered.includes("Tracker code is"), true);
    assert.equal(rendered.includes("blob/main/LICENSE"), true);
  });
});
