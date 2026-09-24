import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appearances,
  appearancesAcross,
  byTime,
  chartInstant,
  chartSegments,
  classifyLadder,
  coveringPair,
  dayMoverPlan,
  defaultChartSeason,
  frequencySeason,
  inTop20,
  isStale,
  endedWaitingText,
  justReset,
  movementSnaps,
  ratingDeltas,
  rosterChanges,
  seasonEnded,
  seasonLabel,
  seriesFor,
  sinceStartLabel,
  versusPreviousSeason,
  weekMoverPlan,
  withTiedCutoff,
  type Row,
  type Snap,
} from "./metrics.ts";

function row(partial: Partial<Row> & Pick<Row, "x_handle" | "rank" | "rating">): Row {
  return {
    wins: 1,
    losses: 0,
    draws: 0,
    ...partial,
  };
}

function snap(season: number, iso: string, entries: Row[], count = entries.length): Snap {
  return { captured_at: iso, season, count, entries };
}

describe("season labels", () => {
  it("labels by number when the stored name disagrees", () => {
    const number = 2;
    const storedName = "Season 1";
    assert.equal(seasonLabel(number), "Season 2");
    assert.notEqual(seasonLabel(number), storedName);
  });
});

describe("ladder states", () => {
  it("treats an empty board as no ranked games", () => {
    const view = classifyLadder([]);
    assert.equal(view.kind, "empty");
    assert.match(view.message, /No ranked games yet this season/);
  });

  it("shows a thin ranked board without padding", () => {
    const view = classifyLadder([
      row({ x_handle: "a", rank: 1, rating: 1002, ranked: true, wins: 1 }),
      row({ x_handle: "b", rank: 2, rating: 1000, ranked: true, wins: 0, losses: 0, draws: 0 }),
      row({ x_handle: "c", rank: 3, rating: 1001, ranked: true, wins: 1 }),
    ]);
    assert.equal(view.kind, "partial");
    if (view.kind !== "partial") return;
    assert.equal(view.rankedCount, 3);
    assert.equal(view.rows.length, 3);
    assert.match(view.message, /3 ranked players so far/);
  });

  it("treats an all-unranked board as empty", () => {
    const view = classifyLadder([
      row({ x_handle: "a", rank: 1, rating: 1000, ranked: false, wins: 0, losses: 0, draws: 0 }),
      row({ x_handle: "b", rank: 2, rating: 1000, ranked: false, wins: 0, losses: 0, draws: 0 }),
      row({ x_handle: "c", rank: 3, rating: 1000, ranked: false, wins: 0, losses: 0, draws: 0 }),
    ]);
    assert.equal(view.kind, "empty");
  });
});

describe("top 20 ties and depth", () => {
  it("includes a rating tie past rank 20 and everyone in a 20-row cut", () => {
    const deep = [
      ...Array.from({ length: 19 }, (_, index) => row({ x_handle: `p${index}`, rank: index + 1, rating: 1500 - index })),
      row({ x_handle: "tied-a", rank: 20, rating: 1400 }),
      row({ x_handle: "tied-b", rank: 21, rating: 1400 }),
      row({ x_handle: "out", rank: 22, rating: 1390 }),
    ];
    const handles = inTop20(deep, deep.length).map((item) => item.x_handle);
    assert.ok(handles.includes("tied-a"));
    assert.ok(handles.includes("tied-b"));
    assert.ok(!handles.includes("out"));

    const shallow = [row({ x_handle: "only", rank: 1, rating: 1100 })];
    assert.equal(inTop20(shallow, 20).length, 1);
  });
});

describe("movers stay inside one season", () => {
  it("rejects a pair whose season numbers differ and does not return deltas", () => {
    const from = snap(2, "2026-09-18T00:00:00Z", [row({ x_handle: "a", rank: 1, rating: 1200 })]);
    const to = snap(7, "2026-09-24T00:00:00Z", [row({ x_handle: "a", rank: 1, rating: 1600 })]);
    const result = ratingDeltas(from, to);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "different-seasons");
  });

  it("does not call a short window a 24 hour delta", () => {
    const snaps = [
      snap(7, "2026-09-24T00:00:00Z", [row({ x_handle: "a", rank: 1, rating: 1100 })]),
      snap(7, "2026-09-24T02:00:00Z", [row({ x_handle: "a", rank: 1, rating: 1120 })]),
    ];
    const plan = dayMoverPlan(snaps, "2026-09-20T00:00:00Z", Date.parse("2026-09-24T02:00:00Z"));
    assert.equal(plan.kind, "not-computed");
    const young = dayMoverPlan(snaps, "2026-09-24T00:00:00Z", Date.parse("2026-09-24T02:00:00Z"));
    assert.equal(young.kind, "since-start");
    if (young.kind === "since-start") {
      assert.equal(young.label, sinceStartLabel(2));
      assert.equal(young.rows[0].delta, 120);
    }
  });

  it("hides players with no games in the season-start view", () => {
    const snaps = [snap(7, "2026-09-26T08:00:00Z", [
      row({ x_handle: "idle", rank: 2, rating: 1000, wins: 0, losses: 0, draws: 0 }),
      row({ x_handle: "played", rank: 1, rating: 1014, wins: 1 }),
    ])];
    const plan = dayMoverPlan(snaps, "2026-09-26T07:00:00Z", Date.parse("2026-09-26T08:00:00Z"));
    assert.equal(plan.kind, "since-start");
    if (plan.kind === "since-start") {
      assert.deepEqual(plan.rows.map((item) => item.handle), ["played"]);
    }
  });

  it("replaces a 7 day window that the season cannot cover", () => {
    const snaps = [
      snap(7, "2026-09-24T00:00:00Z", [
        row({ x_handle: "a", rank: 2, rating: 1100, last_season: { season: 6, rating: 1400, rank: 4 } }),
      ]),
      snap(7, "2026-09-25T00:00:00Z", [
        row({ x_handle: "a", rank: 1, rating: 1120, last_season: { season: 6, rating: 1400, rank: 4 } }),
      ]),
    ];
    const plan = weekMoverPlan(snaps, 7);
    assert.equal(plan.kind, "season-to-date");
    if (plan.kind === "season-to-date") {
      assert.match(plan.note, /7-day view spans seasons; showing season-to-date/);
      assert.equal(plan.deltas?.[0].ratingDelta, 20);
      assert.equal(plan.versusPrevious[0].previousSeason, 6);
      assert.equal(plan.versusPrevious[0].ratingDelta, 1120 - 1400);
    }
  });

  it("a Season 5 snapshot with everyone at 1000 yields no rows", () => {
    const rows = [1, 2, 3].map((rank) =>
      row({
        x_handle: `p${rank}`,
        rank,
        rating: 1000,
        wins: 0,
        losses: 0,
        draws: 0,
        last_season: { season: 4, rating: 1600, rank },
      }),
    );
    assert.equal(versusPreviousSeason(rows, 5).length, 0);
    const plan = weekMoverPlan(
      [snap(5, "2026-09-26T08:00:00Z", rows)],
      5,
      "2026-09-26T07:00:00Z",
      Date.parse("2026-09-26T08:00:00Z"),
    );
    assert.equal(plan.kind, "season-to-date");
    if (plan.kind === "season-to-date") assert.equal(plan.versusPrevious.length, 0);
  });

  it("hides the previous-season finish list during the first 24 hours", () => {
    const played = row({
      x_handle: "played",
      rank: 1,
      rating: 1010,
      wins: 1,
      last_season: { season: 4, rating: 1600, rank: 1 },
    });
    const idle = row({
      x_handle: "idle",
      rank: 2,
      rating: 1000,
      wins: 0,
      losses: 0,
      draws: 0,
      last_season: { season: 4, rating: 1500, rank: 2 },
    });
    const early = weekMoverPlan(
      [snap(5, "2026-09-26T08:00:00Z", [played, idle])],
      5,
      "2026-09-26T07:00:00Z",
      Date.parse("2026-09-26T10:00:00Z"),
    );
    assert.equal(early.kind, "season-to-date");
    if (early.kind === "season-to-date") assert.equal(early.versusPrevious.length, 0);
    const later = weekMoverPlan(
      [snap(5, "2026-09-26T08:00:00Z", [played, idle]), snap(5, "2026-09-27T12:00:00Z", [played, idle])],
      5,
      "2026-09-26T07:00:00Z",
      Date.parse("2026-09-27T12:00:00Z"),
    );
    assert.equal(later.kind, "season-to-date");
    if (later.kind === "season-to-date") {
      assert.deepEqual(later.versusPrevious.map((item) => item.handle), ["played"]);
    }
  });

  it("does not anchor movers on an unverified snapshot or a final", () => {
    const finalSnap = snap(4, "2026-09-23T20:00:00.000Z", [row({ x_handle: "a", rank: 1, rating: 900 })]);
    finalSnap.final = true;
    const unverified = snap(4, "2026-09-23T22:00:00.000Z", [row({ x_handle: "a", rank: 1, rating: 1000 })]);
    unverified.verified = false;
    const hourly = snap(4, "2026-09-23T18:00:00.000Z", [row({ x_handle: "a", rank: 1, rating: 1100 })]);
    const latest = snap(4, "2026-09-24T22:07:00.000Z", [row({ x_handle: "a", rank: 1, rating: 1200 })]);
    const plan = dayMoverPlan(
      [finalSnap, hourly, unverified, latest],
      "2026-09-23T07:00:00Z",
      Date.parse("2026-09-24T22:07:00.000Z"),
    );
    assert.equal(plan.kind, "snapshots");
    if (plan.kind === "snapshots") assert.equal(plan.from.captured_at, hourly.captured_at);
  });
});

describe("entrants and exits", () => {
  it("suppresses the first snapshot of a season", () => {
    const only = snap(7, "2026-09-26T08:00:00Z", [row({ x_handle: "a", rank: 1, rating: 1000 })]);
    const result = rosterChanges(null, only, true);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "new-season");
  });

  it("does not treat a missing name in a shorter snapshot as an exit", () => {
    const wide = snap(7, "2026-09-24T00:00:00Z", [
      row({ x_handle: "a", rank: 1, rating: 1500 }),
      row({ x_handle: "b", rank: 21, rating: 1200 }),
    ], 100);
    const narrow = snap(7, "2026-09-24T01:00:00Z", [
      row({ x_handle: "a", rank: 1, rating: 1510 }),
    ], 20);
    const result = rosterChanges(wide, narrow, false);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "row-counts-differ");
  });

  it("reports a top-20 exit when both snapshots have the same depth", () => {
    const from = snap(7, "2026-09-24T00:00:00Z", [
      row({ x_handle: "a", rank: 1, rating: 1500 }),
      row({ x_handle: "b", rank: 2, rating: 1400 }),
    ], 20);
    const to = snap(7, "2026-09-24T01:00:00Z", [
      row({ x_handle: "a", rank: 1, rating: 1510 }),
      row({ x_handle: "c", rank: 2, rating: 1410 }),
    ], 20);
    const result = rosterChanges(from, to, false);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value.entered.map((item) => item.x_handle), ["c"]);
      assert.equal(result.value.exited[0].handle, "b");
      assert.equal(result.value.exited[0].rankNow, null);
    }
  });
});

describe("frequency", () => {
  it("counts appearances over the snapshots used, including a tie", () => {
    const snaps = [
      snap(7, "2026-09-24T00:00:00Z", [row({ x_handle: "a", rank: 1, rating: 10 }), row({ x_handle: "b", rank: 20, rating: 5 })], 20),
      snap(7, "2026-09-24T01:00:00Z", [row({ x_handle: "a", rank: 1, rating: 10 })], 20),
    ];
    const table = appearances(snaps);
    assert.equal(table.snapshots, 2);
    assert.equal(table.rows.find((item) => item.handle === "a")?.appearances, 2);
    assert.equal(table.rows.find((item) => item.handle === "b")?.appearances, 1);
  });

  it("keeps the per-season breakdown on the all-time total", () => {
    const report = appearancesAcross([
      { season: 2, snaps: [snap(2, "2026-09-18T00:00:00Z", [row({ x_handle: "a", rank: 1, rating: 10 })], 20)] },
      { season: 7, snaps: [snap(7, "2026-09-24T00:00:00Z", [row({ x_handle: "a", rank: 1, rating: 11 })], 20)] },
    ]);
    assert.deepEqual(report.seasons.map((season) => season.snapshots), [1, 1]);
    assert.equal(report.rows[0].total, 2);
    assert.deepEqual(report.rows[0].bySeason.map((item) => item.appearances), [1, 1]);
  });

  it("waits for enough snapshots before ranking a new season", () => {
    assert.equal(frequencySeason(5, 10), "previous");
    assert.equal(frequencySeason(6, 10), "current");
  });

  it("the S4 snapshot count goes from 20 to 19 once the 2:39 PM PT unverified snapshot is excluded", () => {
    const snaps = Array.from({ length: 19 }, (_, index) =>
      snap(4, `2026-09-23T${String(index).padStart(2, "0")}:00:00.000Z`, [row({ x_handle: "a", rank: 1, rating: 1400 })]),
    );
    const unverified = snap(4, "2026-09-24T21:39:55.000Z", [row({ x_handle: "a", rank: 1, rating: 1583 })], 20);
    unverified.verified = false;
    snaps.push(unverified);
    assert.equal(snaps.length, 20);
    assert.equal(movementSnaps(snaps).length, 19);
    assert.equal(appearances(snaps).snapshots, 19);
  });

  it("counts rank 1 through 20 and skips a tied player past rank 20", () => {
    const table = appearances([
      snap(
        4,
        "2026-09-24T21:36:57.000Z",
        [row({ x_handle: "in", rank: 20, rating: 1400 }), row({ x_handle: "tie", rank: 21, rating: 1400 })],
        100,
      ),
    ]);
    assert.equal(table.rows.find((item) => item.handle === "in")?.appearances, 1);
    assert.equal(table.rows.find((item) => item.handle === "tie"), undefined);
  });

  it("includes players tied on the cutoff count", () => {
    const rows = [
      { handle: "a", appearances: 3 },
      { handle: "b", appearances: 2 },
      { handle: "c", appearances: 2 },
    ];
    assert.equal(withTiedCutoff(rows, 2).length, 3);
  });
});

describe("chart seasons", () => {
  it("places an official final at the season boundary", () => {
    const finalSnap = snap(3, "2026-09-24T22:06:41.536Z", [row({ x_handle: "qsr", rank: 1, rating: 1404 })], 452);
    finalSnap.final = true;
    const placed = chartInstant(finalSnap, null, "2026-09-23T07:00:00Z");
    const current = snap(7, "2026-09-23T18:38:30.000Z", [row({ x_handle: "qsr", rank: 2, rating: 1113 })]);
    const points = seriesFor(
      byTime([
        { ...current, captured_at: chartInstant(current, "2026-09-26T07:00:00Z", null) },
        { ...finalSnap, captured_at: placed },
      ]),
      "qsr",
    );
    assert.equal(points[0].season, 3);
    assert.equal(points[0].t, "2026-09-23T07:00:00Z");
    assert.equal(chartSegments(points).length, 2);
    assert.equal(chartSegments(points)[1].points.length, 1);
  });

  it("breaks the line when the season number changes", () => {
    const points = [
      { t: "2026-09-18T00:00:00Z", rating: 1200, rank: 1, season: 2 },
      { t: "2026-09-18T01:00:00Z", rating: 1210, rank: 1, season: 2 },
      { t: "2026-09-24T00:00:00Z", rating: 1004, rank: 4, season: 7 },
    ];
    const segments = chartSegments(points);
    assert.equal(segments.length, 2);
    assert.equal(segments[0].points.length, 2);
    assert.equal(segments[1].season, 7);
  });

  it("defaults to the previous season when the current season has one point", () => {
    const chosen = defaultChartSeason(
      [
        { season: 7, points: 1 },
        { season: 6, points: 4 },
      ],
      7,
      6,
    );
    assert.equal(chosen, 6);
  });
});

describe("freshness", () => {
  it("flags a check older than three hours", () => {
    const now = Date.parse("2026-09-24T12:00:00Z");
    assert.equal(isStale("2026-09-24T08:00:00Z", "2026-09-24T08:00:00Z", now), true);
    assert.equal(isStale("2026-09-24T11:00:00Z", "2026-09-24T08:00:00Z", now), false);
    assert.equal(justReset(23.4), true);
    assert.equal(justReset(24), false);
    assert.equal(seasonEnded("2026-09-26T07:00:00Z", Date.parse("2026-09-26T07:01:00Z")), true);
    assert.equal(seasonEnded("2026-09-26T07:00:00Z", Date.parse("2026-09-26T06:00:00Z")), false);
    assert.equal(endedWaitingText(4, "12:00 AM PT, Sep 26"), "Season 4 ended 12:00 AM PT, Sep 26; waiting for next snapshot");
  });
});

describe("covering pair", () => {
  it("uses a snapshot at least a full day before the latest one", () => {
    const snaps = [
      snap(7, "2026-09-23T18:00:00Z", [row({ x_handle: "a", rank: 1, rating: 1 })]),
      snap(7, "2026-09-24T18:30:00Z", [row({ x_handle: "a", rank: 1, rating: 2 })]),
    ];
    const pair = coveringPair(snaps, 24);
    assert.equal(pair.ok, true);
    if (pair.ok) assert.equal(pair.value.from.captured_at, snaps[0].captured_at);
  });
});
