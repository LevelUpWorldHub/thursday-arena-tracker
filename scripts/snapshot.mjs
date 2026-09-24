import { appendFileSync } from "node:fs";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  applyEndedSeason,
  backfillEnds,
  fingerprint,
  indexSignature,
  normalizeSnap,
  shouldWriteHourly,
  utcDay,
  validateCatalog,
  validateLeaderboard,
  validateSeasonIndex,
} from "./lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seasonsRoot = path.join(root, "data/seasons");
const API = "https://thursdayarena.com/api/public/v1";
const CATALOG_URL = "https://thursdayarena.com/api/catalog";
const USER_AGENT = "thursday-arena-tracker/1.0 (+https://github.com/LevelUpWorldHub/thursday-arena-tracker)";
const FINAL_PAGE_CAP = 20;

function setOutput(status) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `status=${status}\n`);
}

function runImport() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "scripts/import-seed.mjs")], { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`import-seed exited ${code}`))));
  });
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  const remaining = response.headers.get("x-ratelimit-remaining");
  console.log(`${response.status} ${url} rate-remaining=${remaining ?? "n/a"}`);
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status} for ${url}`, status: response.status };
  }
  try {
    return { ok: true, body: await response.json(), status: response.status };
  } catch {
    return { ok: false, error: `Unparseable JSON from ${url}`, status: response.status };
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function loadSeasonSnapshots(number, seasonsDir = seasonsRoot) {
  const dir = path.join(seasonsDir, String(number), "snapshots");
  let names = [];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const snaps = [];
  for (const name of names) {
    const doc = await readJson(path.join(dir, name));
    for (const raw of doc.snapshots || []) {
      const snap = normalizeSnap(raw);
      if (snap) snaps.push(snap);
    }
  }
  snaps.sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
  return snaps;
}

async function storedCurrentNumber(index, seasonsDir = seasonsRoot) {
  if (index?.current && Number.isFinite(index.current.number)) return index.current.number;
  let names = [];
  try {
    names = await readdir(seasonsDir);
  } catch {
    return null;
  }
  const numbers = names.map(Number).filter((number) => Number.isInteger(number));
  if (!numbers.length) return null;
  return Math.max(...numbers);
}

async function writeHourly(snap, seasonsDir = seasonsRoot) {
  const day = utcDay(snap.captured_at);
  const dir = path.join(seasonsDir, String(snap.season.number), "snapshots");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${day}.json`);
  const doc = (await exists(file))
    ? await readJson(file)
    : { date: day, season_number: snap.season.number, snapshots: [] };
  if (!Array.isArray(doc.snapshots)) doc.snapshots = [];
  doc.snapshots.push({
    captured_at: snap.captured_at,
    source: snap.source,
    verified: true,
    final: false,
    season: snap.season,
    count: snap.count,
    entries: snap.entries,
  });
  doc.snapshots.sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
  await writeFile(file, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`wrote hourly s${snap.season.number} ${day} (${doc.snapshots.length} that day)`);
}

async function fetchPages(seasonNumber, maxPages, exhaustive, fetchImpl = fetchJson) {
  const entries = [];
  let season = null;
  let cursor = null;
  let pages = 0;
  while (pages < maxPages) {
    const url = new URL(`${API}/leaderboard`);
    url.searchParams.set("limit", "100");
    if (seasonNumber != null) url.searchParams.set("season", String(seasonNumber));
    if (cursor) url.searchParams.set("cursor", cursor);
    const fetched = await fetchImpl(url);
    if (!fetched.ok) return { ok: false, error: fetched.error };
    const valid = validateLeaderboard(fetched.body);
    if (!valid.ok) return { ok: false, error: valid.error };
    if (seasonNumber != null && valid.season.number !== seasonNumber) {
      return { ok: false, error: `season mismatch: asked ${seasonNumber}, got ${valid.season.number}` };
    }
    if (season && season.number !== valid.season.number) {
      return { ok: false, error: "season number changed while paging" };
    }
    season = valid.season;
    entries.push(...valid.entries);
    pages += 1;
    const next = typeof fetched.body.next_cursor === "string" ? fetched.body.next_cursor : null;
    if (!next || valid.entries.length === 0 || next === cursor) {
      return { ok: true, season, entries, pages, complete: true };
    }
    cursor = next;
  }
  if (!exhaustive) return { ok: true, season, entries, pages, complete: false };
  return { ok: false, error: `stopped after ${maxPages} pages with more cursor pages left` };
}

export async function maybeWriteFinal(previousNumber, options = {}) {
  const seasonsDir = options.seasonsRoot || seasonsRoot;
  const fetchImpl = options.fetchJson || fetchJson;
  const clock = options.now || (() => new Date());
  const file = path.join(seasonsDir, String(previousNumber), "final.json");
  if (await exists(file)) {
    const existing = await readJson(file);
    if (existing.complete !== false) {
      console.log(`final for season ${previousNumber} already stored`);
      return "exists";
    }
    console.log(`retrying incomplete final for season ${previousNumber}`);
  }
  const fetched = await fetchPages(previousNumber, FINAL_PAGE_CAP, false, fetchImpl);
  if (!fetched.ok) {
    console.error(`final skipped: ${fetched.error}`);
    return "skipped";
  }
  await mkdir(path.dirname(file), { recursive: true });
  const capturedAt = clock().toISOString();
  await writeFile(
    file,
    `${JSON.stringify(
      {
        final: true,
        complete: fetched.complete === true,
        captured_at: capturedAt,
        source: `${API}/leaderboard?season=${previousNumber}&limit=100`,
        verified: true,
        season: fetched.season,
        count: fetched.entries.length,
        pages: fetched.pages,
        entries: fetched.entries,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `wrote final season ${previousNumber} (${fetched.entries.length} rows, ${fetched.pages} pages, complete=${fetched.complete === true})`,
  );
  return "wrote";
}

async function maybeWriteCatalog(options = {}) {
  const fetchImpl = options.fetchJson || fetchJson;
  const clock = options.now || (() => new Date());
  const day = utcDay(clock().toISOString());
  const dir = options.catalogRoot || path.join(root, "data/catalog");
  const file = path.join(dir, `${day}.json`);
  if (await exists(file)) {
    console.log(`catalog ${day} already stored`);
    return "exists";
  }
  const fetched = await fetchImpl(CATALOG_URL);
  if (!fetched.ok) {
    console.error(`catalog skipped: ${fetched.error}`);
    return "skipped";
  }
  const valid = validateCatalog(fetched.body);
  if (!valid.ok) {
    console.error(`catalog skipped: ${valid.error}`);
    return "skipped";
  }
  await mkdir(dir, { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify(
      {
        captured_at: clock().toISOString(),
        source: CATALOG_URL,
        count: valid.bots.length,
        bots: valid.bots,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`wrote catalog ${day} (${valid.bots.length} bots)`);
  return "wrote";
}

function upsertSeason(index, number, patch) {
  const seasons = Array.isArray(index.seasons) ? index.seasons : [];
  const current = seasons.find((season) => season.number === number) || { number };
  const next = { ...current, ...patch, number };
  const rest = seasons.filter((season) => season.number !== number);
  rest.push(next);
  index.seasons = rest.sort((a, b) => a.number - b.number);
}

async function writeLastCheck(checkedAt, cacheFile = path.join(root, ".cache", "last-check.json")) {
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, `${JSON.stringify({ checked_at: checkedAt }, null, 2)}\n`);
}

export async function runSnapshot(options = {}) {
  const fetchImpl = options.fetchJson || fetchJson;
  const clock = options.now || (() => new Date());
  const dataRoot = options.root || root;
  const seasonsDir = options.seasonsRoot || path.join(dataRoot, "data/seasons");
  const catalogDir = options.catalogRoot || path.join(dataRoot, "data/catalog");
  const cacheFile = options.cacheFile || path.join(dataRoot, ".cache", "last-check.json");
  if (path.resolve(seasonsDir) === path.resolve(seasonsRoot)) await runImport();
  const indexPath = path.join(seasonsDir, "index.json");
  const index = (await exists(indexPath)) ? await readJson(indexPath) : { seasons: [] };
  const signatureBefore = indexSignature(index);
  const checkedAt = clock().toISOString();

  const seasonFetched = await fetchImpl(`${API}/season`);
  const seasonIndex = seasonFetched.ok ? validateSeasonIndex(seasonFetched.body) : { ok: false, error: seasonFetched.error };
  if (!seasonIndex.ok) console.error(`season index skipped: ${seasonIndex.error}`);

  const board = await fetchPages(null, 1, false, fetchImpl);
  if (!board.ok) {
    console.error(`ladder skipped: ${board.error}`);
    setOutput("skipped");
    return;
  }
  const incoming = board.season.number;
  const storedCurrent = await storedCurrentNumber(index, seasonsDir);
  if (!shouldWriteHourly(incoming, storedCurrent)) {
    console.error(`refusing hourly write: season ${incoming} is below stored current ${storedCurrent}`);
    setOutput("skipped");
    return;
  }

  let wroteFinal = false;
  const closeFinal = async (number) => {
    const finalStatus = await maybeWriteFinal(number, { seasonsRoot: seasonsDir, fetchJson: fetchImpl, now: clock });
    if (finalStatus === "wrote") wroteFinal = true;
    if (finalStatus === "wrote" || finalStatus === "exists") {
      upsertSeason(index, number, { state: "ended" });
    }
  };
  if (Number.isFinite(storedCurrent) && incoming > storedCurrent) {
    console.log(`season transition ${storedCurrent} -> ${incoming}`);
    await closeFinal(storedCurrent);
  } else if (incoming > 1) {
    await closeFinal(incoming - 1);
  }
  for (const season of index.seasons || []) {
    if (season.number < incoming) season.state = "ended";
  }

  const existing = await loadSeasonSnapshots(incoming, seasonsDir);
  const latest = existing[existing.length - 1];
  const nextFp = fingerprint(incoming, board.entries);
  const same = latest && fingerprint(latest.season.number, latest.entries) === nextFp;
  let wroteLadder = false;
  const capturedAt = clock().toISOString();
  if (same) {
    console.log(`season ${incoming} board unchanged; not writing a duplicate snapshot`);
  } else {
    await writeHourly(
      {
        captured_at: capturedAt,
        source: `${API}/leaderboard?limit=100`,
        season: { number: board.season.number, state: board.season.state },
        count: board.entries.length,
        entries: board.entries,
      },
      seasonsDir,
    );
    wroteLadder = true;
  }

  const after = await loadSeasonSnapshots(incoming, seasonsDir);
  const first = after[0]?.captured_at || null;
  const last = after[after.length - 1]?.captured_at || null;
  if (seasonIndex.ok) {
    index.current = seasonIndex.current;
    index.next = seasonIndex.next;
    if (seasonIndex.current.number === incoming) {
      upsertSeason(index, incoming, {
        state: seasonIndex.current.state,
        starts_at: seasonIndex.current.starts_at,
        ends_at: seasonIndex.current.ends_at,
        first_snapshot: first,
        last_snapshot: last,
      });
    }
  }
  upsertSeason(index, incoming, {
    state: board.season.state,
    first_snapshot: first,
    last_snapshot: last,
  });
  applyEndedSeason(index, storedCurrent, incoming);
  backfillEnds(index, incoming);
  const materialIndex = indexSignature(index) !== signatureBefore;
  index.last_checked = checkedAt;
  index.generated_at = checkedAt;
  const catalogStatus = await maybeWriteCatalog({ fetchJson: fetchImpl, now: clock, catalogRoot: catalogDir });
  if (materialIndex || wroteLadder || wroteFinal || catalogStatus === "wrote") {
    await mkdir(seasonsDir, { recursive: true });
    await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  } else {
    console.log("index timestamps only; leaving index.json unchanged");
  }
  await writeLastCheck(checkedAt, cacheFile);

  const status = wroteLadder || wroteFinal || catalogStatus === "wrote" || materialIndex ? "wrote" : "deduped";
  setOutput(status);
  console.log(`status=${status}`);
  return status;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  runSnapshot().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
