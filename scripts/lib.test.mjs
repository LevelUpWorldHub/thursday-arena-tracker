import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildSiteData } from "./build-data.mjs";
import {
  acceptEmptyLadder,
  applyEndedSeason,
  fingerprint,
  indexSignature,
  normalizeSnap,
  playerIdOf,
  retryAfterMs,
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

describe("empty ladder and retry-after", () => {
  it("accepts an empty board right after reset and rejects one mid-season when rows are stored", () => {
    const start = Date.parse("2026-09-23T07:00:00Z");
    assert.equal(acceptEmptyLadder("2026-09-23T07:00:00Z", start + 2 * 36e5, true), true);
    assert.equal(acceptEmptyLadder("2026-09-23T07:00:00Z", start + 30 * 36e5, true), false);
    assert.equal(acceptEmptyLadder("2026-09-23T07:00:00Z", start + 30 * 36e5, false), true);
    assert.equal(acceptEmptyLadder(null, start, true), false);
  });

  it("reads Retry-After seconds and HTTP dates", () => {
    assert.equal(retryAfterMs("0", 1_000), 0);
    assert.equal(retryAfterMs("2", 1_000), 2000);
    assert.equal(retryAfterMs(new Date(5_000).toUTCString(), 1_000), 4000);
    assert.equal(retryAfterMs("", 1_000), 1000);
  });

  it("keeps a string or numeric player id and leaves the fingerprint shape alone", () => {
    const snap = normalizeSnap({
      captured_at: "2026-09-24T00:00:00.000Z",
      season: { number: 4, state: "active" },
      entries: [{ rank: 1, x_handle: "a", rating: 1100, wins: 1, losses: 0, draws: 0, user_id: 42 }],
    });
    assert.equal(snap.entries[0].player_id, "42");
    assert.equal(playerIdOf({ player_id: " p1 " }), "p1");
    const before = fingerprint(4, [{ rank: 1, x_handle: "a", rating: 1100, wins: 1, losses: 0, draws: 0 }]);
    const after = fingerprint(4, [{ rank: 1, x_handle: "a", rating: 1100, wins: 1, losses: 0, draws: 0, player_id: "p1" }]);
    assert.equal(before, after);
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

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function player(rank, handle) {
  return { rank, x_handle: handle, rating: 1100, wins: 1, losses: 0, draws: 0, ranked: true };
}

describe("published site data", () => {
  it("publishes a fixture without copying a mismatched season name", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "arena-site-"));
    const seasons = path.join(dir, "data/seasons");
    await writeJson(path.join(seasons, "index.json"), {
      last_checked: "2026-09-24T22:00:00.000Z",
      current: { number: 4, state: "active", starts_at: "2026-09-23T07:00:00Z", ends_at: "2026-09-26T07:00:00Z" },
      seasons: [{ number: 4, state: "active" }],
    });
    await writeJson(path.join(seasons, "4/snapshots/2026-09-24.json"), {
      date: "2026-09-24",
      season_number: 4,
      snapshots: [
        {
          captured_at: "2026-09-24T18:00:00.000Z",
          verified: true,
          season: { number: 4, name: "Season 1", state: "active" },
          count: 1,
          entries: [player(1, "alpha")],
        },
      ],
    });
    const site = await buildSiteData({ root: dir, outFile: path.join(dir, "site-data.json") });
    assert.equal(JSON.stringify(site).includes("Season 1"), false);
    assert.equal(site.seasons.length, 1);
    assert.equal(site.seasons[0].snapshot_count, site.seasons[0].snapshots.length);
    assert.equal(site.seasons[0].snapshots[0].entries.length, 1);
    assert.equal(site.seasons[0].snapshots[0].season, undefined);
  });

  it("publishes an empty current-season snapshot", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "arena-empty-"));
    const seasons = path.join(dir, "data/seasons");
    await writeJson(path.join(seasons, "index.json"), {
      last_checked: "2026-09-26T07:17:00.000Z",
      current: { number: 5, state: "active", starts_at: "2026-09-26T07:00:00Z", ends_at: null },
      seasons: [
        { number: 4, state: "ended", ends_at: "2026-09-26T07:00:00Z" },
        { number: 5, state: "active", starts_at: "2026-09-26T07:00:00Z" },
      ],
    });
    await writeJson(path.join(seasons, "4/snapshots/2026-09-24.json"), {
      date: "2026-09-24",
      season_number: 4,
      snapshots: [
        {
          captured_at: "2026-09-24T22:00:00.000Z",
          verified: true,
          season: { number: 4, state: "active" },
          count: 1,
          entries: [player(1, "alpha")],
        },
      ],
    });
    await writeJson(path.join(seasons, "5/snapshots/2026-09-26.json"), {
      date: "2026-09-26",
      season_number: 5,
      snapshots: [
        {
          captured_at: "2026-09-26T07:17:00.000Z",
          verified: true,
          season: { number: 5, state: "active" },
          count: 0,
          entries: [],
        },
      ],
    });
    const site = await buildSiteData({ root: dir, outFile: path.join(dir, "site-data.json") });
    const current = site.seasons.find((season) => season.number === 5);
    assert.equal(site.index.current.number, 5);
    assert.equal(current.snapshot_count, 1);
    assert.equal(current.snapshots[0].count, 0);
    assert.equal(current.snapshots[0].entries.length, 0);
    assert.equal(site.seasons.find((season) => season.number === 4).snapshots[0].entries.length, 1);
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
