import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSnap, utcDay } from "./lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seedPath = path.join(root, "data/seed/ladder-history-seed.json");
const seasonsRoot = path.join(root, "data/seasons");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function fileOrNull(file) {
  try {
    return await readJson(file);
  } catch {
    return null;
  }
}

const seed = await readJson(seedPath);
const snaps = (seed.snapshots || []).map(normalizeSnap).filter(Boolean);
const bySeason = new Map();
for (const snap of snaps) {
  const number = snap.season.number;
  if (!bySeason.has(number)) bySeason.set(number, []);
  bySeason.get(number).push(snap);
}

let written = 0;
for (const [number, list] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
  const dir = path.join(seasonsRoot, String(number), "snapshots");
  await mkdir(dir, { recursive: true });
  const byDay = new Map();
  for (const snap of list) {
    const day = utcDay(snap.captured_at);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(snap);
  }
  for (const [day, daySnaps] of byDay) {
    const file = path.join(dir, `${day}.json`);
    const existing = (await fileOrNull(file)) || { date: day, season_number: number, snapshots: [] };
    const seen = new Set((existing.snapshots || []).map((snap) => snap.captured_at));
    for (const snap of daySnaps.sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at))) {
      if (seen.has(snap.captured_at)) continue;
      existing.snapshots.push({
        captured_at: snap.captured_at,
        source: snap.source,
        source_note: snap.source_note,
        verified: snap.verified,
        final: false,
        season: snap.season,
        count: snap.count,
        entries: snap.entries,
      });
      seen.add(snap.captured_at);
      written += 1;
    }
    existing.snapshots.sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
    existing.season_number = number;
    existing.date = day;
    await writeFile(file, `${JSON.stringify(existing, null, 2)}\n`);
  }
}

const indexPath = path.join(seasonsRoot, "index.json");
const index = (await fileOrNull(indexPath)) || { seasons: [] };
const seasons = new Map((index.seasons || []).map((season) => [season.number, season]));
for (const [number, list] of bySeason) {
  const sorted = [...list].sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
  const prior = seasons.get(number) || {};
  seasons.set(number, {
    number,
    state: prior.state || sorted[sorted.length - 1].season.state || "unknown",
    starts_at: prior.starts_at || null,
    ends_at: prior.ends_at || null,
    first_snapshot: prior.first_snapshot || sorted[0].captured_at,
    last_snapshot: prior.last_snapshot || sorted[sorted.length - 1].captured_at,
  });
}
const nextIndex = {
  generated_at: index.generated_at || null,
  last_checked: index.last_checked || null,
  current: index.current || null,
  next: index.next || null,
  seasons: [...seasons.values()].sort((a, b) => a.number - b.number),
};
await mkdir(seasonsRoot, { recursive: true });
await writeFile(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`);
console.log(`import-seed: added ${written} snapshots across ${bySeason.size} season partitions`);
