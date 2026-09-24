import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  applyEndedSeason,
  fingerprint,
  indexSignature,
  normalizeSnap,
  shouldWriteHourly,
  validateLeaderboard,
  validateSeasonIndex,
} from "./lib.mjs";

describe("hourly guard", () => {
  it("refuses a season number below the stored current season", () => {
    assert.equal(shouldWriteHourly(3, 5), false);
    assert.equal(shouldWriteHourly(5, 5), true);
    assert.equal(shouldWriteHourly(6, 5), true);
    assert.equal(shouldWriteHourly(5, null), true);
  });
});

describe("leaderboard validation", () => {
  it("accepts an explicit empty ladder and rejects a body that is not a ladder", () => {
    const empty = validateLeaderboard({ data: [], season: { number: 8, name: "ignored", state: "active" } });
    assert.equal(empty.ok, true);
    if (empty.ok) assert.equal(empty.empty, true);
    assert.equal(validateLeaderboard({ error: "nope" }).ok, false);
    assert.equal(validateLeaderboard({ data: [{ x_handle: "a" }], season: { number: 8 } }).ok, false);
  });

  it("reads the season index without trusting a display name", () => {
    const parsed = validateSeasonIndex({
      current: { number: 8, name: "Season 1", state: "active", starts_at: "2026-09-26T07:00:00Z", ends_at: null },
      next: null,
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.current.number, 8);
      assert.equal("name" in parsed.current, false);
    }
  });
});

describe("seed provenance", () => {
  it("relabels snapshot 23 and marks snapshot 24 unverified", async () => {
    const seed = JSON.parse(await readFile(new URL("../data/seed/ladder-history-seed.json", import.meta.url), "utf8"));
    const snapshot23 = seed.snapshots[22];
    const snapshot24 = seed.snapshots[23];
    assert.equal(snapshot23.source, "site/_draft-local-20260924/data/snapshots/2026-09-24.json");
    assert.match(snapshot23.source_note, /not strategy\/data-20260924/);
    assert.equal(snapshot24.verified, false);
    assert.match(snapshot24.source_note, /Unverified/);
    const mismatched = seed.snapshots.find((snap) => snap.season.name !== `Season ${snap.season.number}`);
    assert.ok(mismatched);
    assert.notEqual(`Season ${mismatched.season.number}`, mismatched.season.name);
  });
});

describe("published site data", () => {
  it("keeps row counts and does not publish mismatched season names", async () => {
    const site = JSON.parse(await readFile(new URL("../public/data/site-data.json", import.meta.url), "utf8"));
    const blob = JSON.stringify(site);
    assert.equal(blob.includes("Season 1"), false);
    const counts = site.seasons.flatMap((season) => season.snapshots.map((snap) => snap.count));
    assert.ok(counts.includes(100));
    assert.ok(counts.includes(20));
    for (const season of site.seasons) {
      assert.equal(typeof season.number, "number");
      assert.equal(season.snapshot_count, season.snapshots.length);
      for (const snap of season.snapshots) {
        assert.equal(snap.entries.length > 0, true);
        assert.equal(snap.season, undefined);
      }
    }
  });
});

describe("season end time", () => {
  it("does not overwrite an end time from a lagged /season current start", () => {
    const index = {
      current: { number: 4, state: "active", starts_at: "2026-09-23T07:00:00Z", ends_at: "2026-09-26T07:00:00Z" },
      next: { number: 5, state: "scheduled", starts_at: "2026-09-26T07:00:00Z", ends_at: null },
      seasons: [{ number: 4, state: "active", starts_at: "2026-09-23T07:00:00Z", ends_at: "2026-09-26T07:00:00Z" }],
    };
    applyEndedSeason(index, 4, 5);
    assert.equal(index.seasons.find((season) => season.number === 4).ends_at, "2026-09-26T07:00:00Z");
  });

  it("uses the next season start when /season has not caught up and the end is unknown", () => {
    const index = {
      current: { number: 4, state: "active", starts_at: "2026-09-23T07:00:00Z", ends_at: "2026-09-26T07:00:00Z" },
      next: { number: 5, state: "scheduled", starts_at: "2026-09-26T07:00:00Z", ends_at: null },
      seasons: [{ number: 4, state: "active", starts_at: "2026-09-23T07:00:00Z", ends_at: null }],
    };
    applyEndedSeason(index, 4, 5);
    assert.equal(index.seasons.find((season) => season.number === 4).ends_at, "2026-09-26T07:00:00Z");
  });

  it("leaves the end unset when the lagged clock has no successor start", () => {
    const index = {
      current: { number: 4, state: "active", starts_at: "2026-09-23T07:00:00Z", ends_at: null },
      next: null,
      seasons: [{ number: 4, state: "active", starts_at: "2026-09-23T07:00:00Z" }],
    };
    applyEndedSeason(index, 4, 5);
    assert.equal(index.seasons.find((season) => season.number === 4).ends_at, null);
  });
});

describe("index commits", () => {
  it("ignores last-checked timestamps", () => {
    const before = { last_checked: "2026-09-24T00:00:00Z", generated_at: "2026-09-24T00:00:00Z", current: { number: 4 } };
    const after = { last_checked: "2026-09-24T01:00:00Z", generated_at: "2026-09-24T01:00:00Z", current: { number: 4 } };
    assert.equal(indexSignature(before), indexSignature(after));
  });
});

describe("stored season 4 snapshots", () => {
  it("keeps the unverified 2:39 PM PT snapshot in the archive and drops the 3:07 PM duplicate", async () => {
    const day = JSON.parse(await readFile(new URL("../data/seasons/4/snapshots/2026-09-24.json", import.meta.url), "utf8"));
    const earlier = JSON.parse(await readFile(new URL("../data/seasons/4/snapshots/2026-09-23.json", import.meta.url), "utf8"));
    const snaps = [...earlier.snapshots, ...day.snapshots].map((raw) => normalizeSnap({ ...raw, season: raw.season || { number: 4 } }));
    assert.equal(snaps.some((snap) => snap.captured_at === "2026-09-24T22:07:18.845Z"), false);
    const unverified = snaps.filter((snap) => snap.verified === false);
    assert.equal(unverified.length, 1);
    assert.equal(unverified[0].captured_at, "2026-09-24T21:39:55.000Z");
  });
});

describe("fingerprint", () => {
  it("matches the same board regardless of row order", () => {
    const a = fingerprint(8, [{ rank: 2, x_handle: "b", rating: 2, wins: 0, losses: 0, draws: 0 }, { rank: 1, x_handle: "a", rating: 3, wins: 1, losses: 0, draws: 0 }]);
    const b = fingerprint(8, [{ rank: 1, x_handle: "a", rating: 3, wins: 1, losses: 0, draws: 0 }, { rank: 2, x_handle: "b", rating: 2, wins: 0, losses: 0, draws: 0 }]);
    assert.equal(a, b);
  });
});
