import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildSiteData } from "./build-data.mjs";
import { maybeWriteFinal, runSnapshot } from "./snapshot.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function readOrNull(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

function row(rank, handle) {
  return { rank, x_handle: handle, rating: 1100, wins: 1, losses: 0, draws: 0 };
}

describe("partial season final", () => {
  it("saves 2000 rows with complete:false when the cursor never ends", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "arena-final-"));
    let pages = 0;
    const fetchJson = async () => {
      const start = pages * 100;
      pages += 1;
      return {
        ok: true,
        status: 200,
        body: {
          season: { number: 9, state: "ended" },
          next_cursor: `cursor-${pages}`,
          data: Array.from({ length: 100 }, (_, index) => row(start + index + 1, `player${start + index}`)),
        },
      };
    };
    const status = await maybeWriteFinal(9, {
      seasonsRoot: dir,
      fetchJson,
      now: () => new Date("2026-09-24T23:00:00.000Z"),
    });
    assert.equal(status, "wrote");
    assert.equal(pages, 20);
    const saved = JSON.parse(await readFile(path.join(dir, "9", "final.json"), "utf8"));
    assert.equal(saved.complete, false);
    assert.equal(saved.final, true);
    assert.equal(saved.count, 2000);
    assert.equal(saved.entries.length, 2000);
    assert.equal(saved.pages, 20);
  });
});

describe("quiet snapshot", () => {
  it("publishes the run time as last_checked from a temp fixture and leaves the repo untouched", async () => {
    const repoCache = path.join(root, ".cache/last-check.json");
    const cacheBefore = await readOrNull(repoCache);
    const gitBefore = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
    const dir = await mkdtemp(path.join(tmpdir(), "arena-quiet-"));
    const olderAt = "2026-09-24T22:06:41.542Z";
    const latestAt = "2026-09-25T00:17:00.000Z";
    const checkedAt = "2026-09-25T00:17:00.000Z";
    const current = {
      number: 4,
      state: "active",
      starts_at: "2026-09-23T07:00:00Z",
      ends_at: "2026-09-26T07:00:00Z",
    };
    const next = { number: 5, state: "scheduled", starts_at: "2026-09-26T07:00:00Z", ends_at: null };
    const latestEntries = [row(1, "alpha")];
    const seasons = path.join(dir, "data/seasons");
    await writeJson(path.join(seasons, "index.json"), {
      generated_at: olderAt,
      last_checked: olderAt,
      current,
      next,
      seasons: [
        { number: 3, state: "ended", starts_at: null, ends_at: "2026-09-23T07:00:00Z" },
        {
          number: 4,
          state: "active",
          starts_at: current.starts_at,
          ends_at: current.ends_at,
          first_snapshot: olderAt,
          last_snapshot: latestAt,
        },
      ],
    });
    await writeJson(path.join(seasons, "3/final.json"), {
      final: true,
      captured_at: "2026-09-23T07:00:00.000Z",
      season: { number: 3, state: "ended" },
      count: 1,
      entries: [row(1, "prior")],
    });
    await writeJson(path.join(seasons, "4/snapshots/2026-09-24.json"), {
      date: "2026-09-24",
      season_number: 4,
      snapshots: [
        {
          captured_at: olderAt,
          verified: true,
          final: false,
          season: { number: 4, state: "active" },
          count: 1,
          entries: [row(1, "oldplayer")],
        },
      ],
    });
    await writeJson(path.join(seasons, "4/snapshots/2026-09-25.json"), {
      date: "2026-09-25",
      season_number: 4,
      snapshots: [
        {
          captured_at: latestAt,
          verified: true,
          final: false,
          season: { number: 4, state: "active" },
          count: 1,
          entries: latestEntries,
        },
      ],
    });
    await writeJson(path.join(dir, "data/catalog/2026-09-25.json"), {
      captured_at: latestAt,
      bots: [],
    });
    const fetchJson = async (url) => {
      const href = String(url);
      if (href.includes("/season") && !href.includes("/leaderboard")) {
        return { ok: true, status: 200, body: { current, next } };
      }
      if (href.includes("/leaderboard")) {
        return {
          ok: true,
          status: 200,
          body: {
            season: { number: 4, state: "active", name: "Season 4" },
            data: latestEntries,
            next_cursor: null,
          },
        };
      }
      throw new Error(`unexpected fetch ${href}`);
    };
    const status = await runSnapshot({
      root: dir,
      fetchJson,
      now: () => new Date(checkedAt),
    });
    assert.equal(status, "deduped");
    const cache = JSON.parse(await readFile(path.join(dir, ".cache/last-check.json"), "utf8"));
    assert.equal(cache.checked_at, checkedAt);
    const nextDay = JSON.parse(await readFile(path.join(seasons, "4/snapshots/2026-09-25.json"), "utf8"));
    const previousDay = JSON.parse(await readFile(path.join(seasons, "4/snapshots/2026-09-24.json"), "utf8"));
    assert.equal(nextDay.snapshots.length, 1);
    assert.equal(previousDay.snapshots.length, 1);
    const site = await buildSiteData({ root: dir, outFile: path.join(dir, "site-data.json") });
    assert.equal(site.index.last_checked, checkedAt);
    assert.equal(await readOrNull(repoCache), cacheBefore);
    assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }), gitBefore);
  });
});
