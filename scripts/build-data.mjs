import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprint, normalizeSnap, summarizeCatalog } from "./lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function slimEntry(entry, detailed) {
  const row = {
    rank: entry.rank,
    x_handle: entry.x_handle,
    rating: entry.rating,
    wins: entry.wins,
    losses: entry.losses,
    draws: entry.draws,
  };
  if (entry.ranked === true || entry.ranked === false) row.ranked = entry.ranked;
  if (typeof entry.player_id === "string" && entry.player_id) row.player_id = entry.player_id;
  if (detailed && entry.avatar_url) row.avatar_url = entry.avatar_url;
  if (detailed && entry.last_season) row.last_season = entry.last_season;
  return row;
}

async function seasonNumbers(seasonsDir) {
  let names = [];
  try {
    names = await readdir(seasonsDir);
  } catch {
    return [];
  }
  return names.map(Number).filter((number) => Number.isInteger(number)).sort((a, b) => a - b);
}

async function loadSeason(seasonsDir, number) {
  const snaps = [];
  const dir = path.join(seasonsDir, String(number), "snapshots");
  let names = [];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    names = [];
  }
  for (const name of names) {
    const doc = await readJson(path.join(dir, name));
    for (const raw of doc.snapshots || []) {
      const snap = normalizeSnap({ ...raw, season: raw.season || { number } });
      if (snap && snap.season.number === number) snaps.push({ ...snap, final: false });
    }
  }
  snaps.sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
  let hasFinal = false;
  try {
    const finalDoc = await readJson(path.join(seasonsDir, String(number), "final.json"));
    const snap = normalizeSnap({ ...finalDoc, final: true, season: finalDoc.season || { number } });
    if (snap && snap.season.number === number) {
      hasFinal = true;
      const sameAsLatest =
        snaps.length > 0 &&
        fingerprint(number, snaps[snaps.length - 1].entries) === fingerprint(number, snap.entries);
      if (sameAsLatest) snaps[snaps.length - 1].final = true;
      else snaps.push(snap);
    }
  } catch {
    hasFinal = false;
  }
  snaps.sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
  return { snaps, hasFinal };
}

async function loadCatalog(catalogDir) {
  let names = [];
  try {
    names = (await readdir(catalogDir)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return null;
  }
  if (!names.length) return null;
  const doc = await readJson(path.join(catalogDir, names[names.length - 1]));
  if (!doc || !Array.isArray(doc.bots) || typeof doc.captured_at !== "string") return null;
  return summarizeCatalog(doc.bots, doc.captured_at);
}

function preferNewerCheck(committed, cached) {
  const committedMs = Date.parse(committed || "");
  const cachedMs = Date.parse(cached || "");
  if (Number.isFinite(cachedMs) && (!Number.isFinite(committedMs) || cachedMs > committedMs)) return cached;
  return committed || null;
}

export async function buildSiteData(options = {}) {
  const dataRoot = options.root || root;
  const seasonsDir = options.seasonsRoot || path.join(dataRoot, "data/seasons");
  const catalogDir = options.catalogRoot || path.join(dataRoot, "data/catalog");
  const cacheFile = options.cacheFile || path.join(dataRoot, ".cache", "last-check.json");
  const outFile = options.outFile || path.join(dataRoot, "public/data/site-data.json");

  let index = null;
  try {
    index = await readJson(path.join(seasonsDir, "index.json"));
  } catch {
    index = null;
  }

  const publishedSeasons = [];
  for (const number of await seasonNumbers(seasonsDir)) {
    const loaded = await loadSeason(seasonsDir, number);
    const snaps = loaded.snaps;
    if (!snaps.length) continue;
    const lastIndex = snaps.length - 1;
    publishedSeasons.push({
      number,
      snapshot_count: snaps.length,
      has_final: loaded.hasFinal,
      snapshots: snaps.map((snap, indexInSeason) => ({
        captured_at: snap.captured_at,
        count: snap.count,
        final: snap.final === true,
        ...(snap.complete === false ? { complete: false } : {}),
        ...(snap.verified === false ? { verified: false } : {}),
        entries: snap.entries.map((entry) => slimEntry(entry, indexInSeason === lastIndex || snap.final)),
      })),
    });
  }

  let cached = null;
  try {
    const cache = await readJson(cacheFile);
    cached = typeof cache?.checked_at === "string" ? cache.checked_at : null;
  } catch {
    cached = null;
  }

  const publicIndex = {
    last_checked: preferNewerCheck(index?.last_checked || null, cached),
    ...(index?.fetch_failed === true ? { fetch_failed: true } : {}),
    current: index?.current
      ? {
          number: index.current.number,
          state: index.current.state,
          starts_at: index.current.starts_at || null,
          ends_at: index.current.ends_at || null,
        }
      : null,
    next: index?.next
      ? {
          number: index.next.number,
          state: index.next.state,
          starts_at: index.next.starts_at || null,
          ends_at: index.next.ends_at ?? null,
        }
      : null,
    seasons: publishedSeasons.map((season) => {
      const fromIndex = (index?.seasons || []).find((item) => item.number === season.number) || {};
      const snaps = season.snapshots;
      return {
        number: season.number,
        state: fromIndex.state || "unknown",
        starts_at: fromIndex.starts_at || null,
        ends_at: fromIndex.ends_at || null,
        first_snapshot: snaps[0]?.captured_at || null,
        last_snapshot: snaps[snaps.length - 1]?.captured_at || null,
        snapshot_count: season.snapshot_count,
        has_final: season.has_final,
      };
    }),
  };

  const payload = {
    generated_at: new Date().toISOString(),
    index: publicIndex,
    seasons: publishedSeasons,
    catalog: await loadCatalog(catalogDir),
  };

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload));
  console.log(
    `wrote ${path.relative(dataRoot, outFile) || outFile} (${publishedSeasons.map((season) => `${season.number}:${season.snapshot_count}`).join(", ") || "no seasons"})`,
  );
  return payload;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await buildSiteData();
}
