const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

export function fingerprint(seasonNumber, entries) {
  const rows = [...entries].sort((a, b) => a.rank - b.rank || String(a.x_handle).localeCompare(String(b.x_handle)));
  return JSON.stringify([
    seasonNumber,
    rows.map((entry) => [
      entry.rank,
      entry.x_handle,
      entry.rating,
      entry.wins,
      entry.losses,
      entry.draws,
      entry.ranked === true ? 1 : entry.ranked === false ? 0 : null,
    ]),
  ]);
}

export function utcDay(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function validateLeaderboard(body) {
  if (!body || !Array.isArray(body.data)) {
    return { ok: false, error: "leaderboard response has no data array" };
  }
  if (!body.season || typeof body.season.number !== "number" || !Number.isFinite(body.season.number)) {
    return { ok: false, error: "leaderboard response has no season number" };
  }
  const season = {
    number: body.season.number,
    name: typeof body.season.name === "string" ? body.season.name : null,
    state: typeof body.season.state === "string" ? body.season.state : "unknown",
  };
  if (body.data.length === 0) {
    return { ok: true, season, entries: [], empty: true };
  }
  for (const row of body.data) {
    if (!row || typeof row.x_handle !== "string" || row.x_handle.length === 0) {
      return { ok: false, error: "leaderboard row missing x_handle" };
    }
    if (!Number.isFinite(row.rank) || !Number.isFinite(row.rating)) {
      return { ok: false, error: "leaderboard row missing rank or rating" };
    }
    if (!Number.isFinite(row.wins) || !Number.isFinite(row.losses) || !Number.isFinite(row.draws)) {
      return { ok: false, error: "leaderboard row missing W-L-D" };
    }
  }
  return { ok: true, season, entries: body.data, empty: false };
}

export function validateSeasonIndex(body) {
  if (!body || !body.current || typeof body.current.number !== "number") {
    return { ok: false, error: "season index missing current.number" };
  }
  const current = {
    number: body.current.number,
    state: typeof body.current.state === "string" ? body.current.state : "unknown",
    starts_at: typeof body.current.starts_at === "string" ? body.current.starts_at : null,
    ends_at: typeof body.current.ends_at === "string" ? body.current.ends_at : null,
  };
  const next = body.next && typeof body.next.number === "number"
    ? {
        number: body.next.number,
        state: typeof body.next.state === "string" ? body.next.state : "unknown",
        starts_at: typeof body.next.starts_at === "string" ? body.next.starts_at : null,
        ends_at: typeof body.next.ends_at === "string" ? body.next.ends_at : null,
      }
    : null;
  return { ok: true, current, next };
}

export function validateCatalog(body) {
  if (!Array.isArray(body) || body.length === 0) {
    return { ok: false, error: "catalog response is empty" };
  }
  for (const bot of body) {
    if (!bot || typeof bot.rarity !== "string" || typeof bot.name !== "string") {
      return { ok: false, error: "catalog row missing name or rarity" };
    }
    if (!Number.isFinite(bot.cost) || !Number.isFinite(bot.attack) || !Number.isFinite(bot.health)) {
      return { ok: false, error: "catalog row missing cost, attack, or health" };
    }
  }
  return { ok: true, bots: body };
}

export function seasonStart(index, number) {
  if (index?.current?.number === number && index.current.starts_at) return index.current.starts_at;
  if (index?.next?.number === number && index.next.starts_at) return index.next.starts_at;
  const listed = (index?.seasons || []).find((season) => season.number === number);
  return listed?.starts_at || null;
}

export function applyEndedSeason(index, storedCurrent, incoming) {
  if (!Number.isFinite(storedCurrent) || !(incoming > storedCurrent)) return;
  const seasons = Array.isArray(index.seasons) ? index.seasons : [];
  const prior = seasons.find((season) => season.number === storedCurrent) || { number: storedCurrent };
  const successorStart = seasonStart(index, incoming);
  const next = { ...prior, number: storedCurrent, state: "ended" };
  if (!prior.ends_at && successorStart) next.ends_at = successorStart;
  else next.ends_at = prior.ends_at || null;
  index.seasons = [...seasons.filter((season) => season.number !== storedCurrent), next].sort((a, b) => a.number - b.number);
}

export function backfillEnds(index, incoming) {
  for (const season of index.seasons || []) {
    if (season.ends_at || season.number >= incoming) continue;
    const starts = seasonStart(index, season.number + 1);
    if (starts) season.ends_at = starts;
  }
}

export function indexSignature(index) {
  const copy = structuredClone(index ?? {});
  delete copy.last_checked;
  delete copy.generated_at;
  return JSON.stringify(copy);
}

export function retryAfterMs(header, nowMs = Date.now()) {
  if (header == null || String(header).trim() === "") return 1000;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(String(header));
  if (!Number.isNaN(when)) return Math.max(0, when - nowMs);
  return 1000;
}

/** An empty board is real right after reset. Mid-season, keep the last snapshot that had rows. */
export function acceptEmptyLadder(startsAt, nowMs, hasStoredRows) {
  if (!hasStoredRows) return true;
  if (typeof startsAt !== "string") return false;
  const start = Date.parse(startsAt);
  if (Number.isNaN(start)) return false;
  const ageHours = (nowMs - start) / 36e5;
  return ageHours >= 0 && ageHours < 24;
}

export function shouldWriteHourly(incomingNumber, storedCurrent) {
  if (!Number.isFinite(incomingNumber)) return false;
  if (!Number.isFinite(storedCurrent)) return true;
  return incomingNumber >= storedCurrent;
}

function average(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return null;
  const total = nums.reduce((sum, value) => sum + value, 0);
  return Math.round((total / nums.length) * 10) / 10;
}

export function summarizeCatalog(bots, capturedAt) {
  const groups = new Map();
  const crews = new Map();
  const seasons = new Map();
  for (const bot of bots) {
    const rarity = bot.rarity || "unknown";
    if (!groups.has(rarity)) groups.set(rarity, []);
    groups.get(rarity).push(bot);
    const crew = bot.crew || "unknown";
    crews.set(crew, (crews.get(crew) || 0) + 1);
    const seasonKey = Number.isFinite(bot.season) ? String(bot.season) : "unknown";
    seasons.set(seasonKey, (seasons.get(seasonKey) || 0) + 1);
  }
  const rarities = [...groups.entries()]
    .sort((a, b) => {
      const ai = RARITY_ORDER.indexOf(a[0]);
      const bi = RARITY_ORDER.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .map(([rarity, list]) => ({
      rarity,
      count: list.length,
      avg_cost: average(list.map((bot) => bot.cost)),
      avg_attack: average(list.map((bot) => bot.attack)),
      avg_health: average(list.map((bot) => bot.health)),
    }));
  return {
    captured_at: capturedAt,
    total: bots.length,
    rarities,
    crews: [...crews.entries()]
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .map(([crew, count]) => ({ crew, count })),
    season_tags: [...seasons.entries()]
      .filter(([season]) => season !== "unknown")
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([season, count]) => ({ season: Number(season), count })),
  };
}

export function playerIdOf(entry) {
  if (!entry || typeof entry !== "object") return null;
  for (const value of [entry.player_id, entry.user_id, entry.id]) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function normalizeEntry(entry) {
  if (!entry || typeof entry.x_handle !== "string") return null;
  if (!Number.isFinite(entry.rank) || !Number.isFinite(entry.rating)) return null;
  const row = {
    rank: entry.rank,
    x_handle: entry.x_handle,
    rating: entry.rating,
    wins: Number.isFinite(entry.wins) ? entry.wins : 0,
    losses: Number.isFinite(entry.losses) ? entry.losses : 0,
    draws: Number.isFinite(entry.draws) ? entry.draws : 0,
  };
  if (entry.ranked === true || entry.ranked === false) row.ranked = entry.ranked;
  const rawId = playerIdOf(entry);
  if (rawId) row.player_id = rawId;
  if (typeof entry.avatar_url === "string") row.avatar_url = entry.avatar_url;
  if (entry.last_season && Number.isFinite(entry.last_season.season)) {
    row.last_season = {
      season: entry.last_season.season,
      rating: Number.isFinite(entry.last_season.rating) ? entry.last_season.rating : null,
      rank: Number.isFinite(entry.last_season.rank) ? entry.last_season.rank : null,
    };
  }
  return row;
}

export function normalizeSnap(raw) {
  const captured = raw?.captured_at_utc || raw?.captured_at;
  if (!captured || !raw.season || typeof raw.season.number !== "number" || !Array.isArray(raw.entries)) {
    return null;
  }
  const when = new Date(captured);
  if (Number.isNaN(when.getTime())) return null;
  const entries = raw.entries.map(normalizeEntry).filter(Boolean);
  return {
    captured_at: when.toISOString(),
    source: typeof raw.source === "string" ? raw.source : null,
    source_note: typeof raw.source_note === "string" ? raw.source_note : null,
    verified: raw.verified === false ? false : true,
    final: raw.final === true,
    ...(raw.complete === false ? { complete: false } : {}),
    season: {
      number: raw.season.number,
      state: typeof raw.season.state === "string" ? raw.season.state : "unknown",
    },
    count: Number.isFinite(raw.count) ? raw.count : entries.length,
    entries,
  };
}
