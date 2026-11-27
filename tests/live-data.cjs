const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const oneDayMs = 24 * 60 * 60 * 1000;
const durations = ["short", "20-30", "30-40", "40+", "unknown"];
const ranks = ["low", "mid", "high", "unknown"];
const dimensions = durations.flatMap(duration => ranks.map(rank => duration + "/" + rank));
const expectedHeader = ["patch", "duration_band", "rank_band", "n", "wins"];

function dateMs(day) {
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
  const ms = Date.parse(day + "T00:00:00Z");
  assert.ok(Number.isFinite(ms), "Invalid UTC day: " + day);
  assert.equal(new Date(ms).toISOString().slice(0, 10), day);
  return ms;
}

function checkCounts(n, wins, where) {
  assert.ok(Number.isSafeInteger(n) && n >= 0, "Invalid match count in " + where);
  assert.ok(Number.isSafeInteger(wins) && wins >= 0 && wins <= n, "Invalid win count in " + where);
}

// This schema contains fixed labels, integers, and no embedded separators.
// read.csv/write.csv can wrap the text fields and header in double quotes.
function fields(line) {
  return line.split(",").map(value => value.replace(/^"([^"]*)"$/, "$1"));
}

test("daily ranked archives reproduce every published live win count and coverage field", () => {
  const context = {window: {}};
  vm.runInNewContext(fs.readFileSync(path.join(root, "docs/live-data.js"), "utf8"), context);
  const data = context.window.LIVE_DATA;
  assert.ok(data && Array.isArray(data.patches) && data.patches.length > 0);
  const cutoff = dateMs(data.throughDate);
  assert.match(data.asOfUtc, /Z$/);
  assert.ok(Date.parse(data.asOfUtc) >= cutoff, "The reporting horizon is after the build date");

  const archiveDir = path.join(root, "data/live");
  const archives = fs.readdirSync(archiveDir).filter(name => name.endsWith(".csv")).sort();
  const byPatch = new Map();
  let previousStart = -Infinity;
  let previousEnd = null;
  for (const patch of data.patches) {
    assert.equal(typeof patch.id, "string");
    assert.ok(!byPatch.has(patch.id), "Duplicate patch ID: " + patch.id);
    const start = dateMs(patch.firstDay);
    const end = dateMs(patch.lastDay);
    assert.ok(start >= previousStart && start <= end && end <= cutoff, "Invalid patch window for " + patch.id);
    // Adjacent major versions can share their UTC release day.
    if (previousEnd !== null) assert.ok(start === previousEnd || start === previousEnd + oneDayMs,
      "Gap or multi-day overlap before " + patch.id);
    previousStart = start;
    previousEnd = end;
    byPatch.set(patch.id, {
      patch, covered: [], cells: new Map(dimensions.map(key => [key, {n: 0, wins: 0}]))
    });
  }

  for (const name of archives) {
    const day = name.slice(0, -4);
    assert.ok(dateMs(day) <= cutoff, "Archive exceeds reporting horizon: " + name);
    const applicable = [...byPatch.values()].filter(({patch}) => patch.firstDay <= day && day <= patch.lastDay);
    assert.ok(applicable.length > 0, "Archive outside all patch windows: " + name);
    for (const record of applicable) record.covered.push(day);
    const lines = fs.readFileSync(path.join(archiveDir, name), "utf8").trimEnd().split(/\r?\n/);
    assert.deepEqual(fields(lines[0]), expectedHeader, "Unexpected header in " + name);
    const seen = new Set();
    for (const line of lines.slice(1)) {
      const items = fields(line);
      assert.equal(items.length, expectedHeader.length, "Wrong number of columns in " + name);
      const [id, duration, rank, nText, winsText] = items;
      const record = byPatch.get(id);
      assert.ok(applicable.includes(record), "Patch outside its date window in " + name);
      const key = duration + "/" + rank;
      const cell = record.cells.get(key);
      assert.ok(cell, "Unknown group in " + name + ": " + key);
      assert.ok(!seen.has(id + "/" + key), "Duplicate patch and group in " + name);
      seen.add(id + "/" + key);
      assert.match(nText, /^\d+$/);
      assert.match(winsText, /^\d+$/);
      const n = Number(nText);
      const wins = Number(winsText);
      checkCounts(n, wins, name);
      cell.n += n;
      cell.wins += wins;
    }
  }

  for (const {patch, covered, cells} of byPatch.values()) {
    const days = 1 + (dateMs(patch.lastDay) - dateMs(patch.firstDay)) / oneDayMs;
    assert.equal(patch.expectedDays, days, "Wrong expected coverage for " + patch.id);
    assert.equal(patch.coveredDays, covered.length, "Wrong archived coverage for " + patch.id);
    assert.equal(patch.latestDay, covered.at(-1) ?? null, "Wrong latest date for " + patch.id);
    assert.equal(patch.complete, covered.length === days, "Wrong completion state for " + patch.id);
    assert.equal(patch.cells.length, dimensions.length, "Incomplete cell grid for " + patch.id);
    for (const row of patch.cells) {
      const key = row.duration + "/" + row.rank;
      checkCounts(row.n, row.wins, patch.id + " " + key);
      assert.deepEqual({n: row.n, wins: row.wins}, cells.get(key), "Archive mismatch for " + patch.id + " " + key);
      cells.delete(key);
    }
    assert.equal(cells.size, 0, "Missing groups in " + patch.id);
  }
});
