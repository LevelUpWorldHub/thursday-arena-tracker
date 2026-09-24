import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { maybeWriteFinal, runSnapshot } from "./snapshot.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  it("publishes the run time as last_checked and leaves git clean", async () => {
    const index = JSON.parse(await readFile(path.join(root, "data/seasons/index.json"), "utf8"));
    const day = JSON.parse(await readFile(path.join(root, "data/seasons/4/snapshots/2026-09-24.json"), "utf8"));
    const latest = day.snapshots[day.snapshots.length - 1];
    const checkedAt = "2026-09-24T23:17:00.000Z";
    const fetchJson = async (url) => {
      const href = String(url);
      if (href.includes("/season") && !href.includes("/leaderboard")) {
        return { ok: true, status: 200, body: { current: index.current, next: index.next } };
      }
      if (href.includes("/leaderboard")) {
        return {
          ok: true,
          status: 200,
          body: {
            season: { number: latest.season.number, state: latest.season.state, name: "Season 4" },
            data: latest.entries,
            next_cursor: null,
          },
        };
      }
      throw new Error(`unexpected fetch ${href}`);
    };
    const status = await runSnapshot({ fetchJson, now: () => new Date(checkedAt) });
    assert.equal(status, "deduped");
    const cache = JSON.parse(await readFile(path.join(root, ".cache/last-check.json"), "utf8"));
    assert.equal(cache.checked_at, checkedAt);
    execFileSync(process.execPath, ["scripts/build-data.mjs"], { cwd: root, stdio: "inherit" });
    const site = JSON.parse(await readFile(path.join(root, "public/data/site-data.json"), "utf8"));
    assert.equal(site.index.last_checked, checkedAt);
    const porcelain = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
    assert.equal(porcelain, "");
  });
});
