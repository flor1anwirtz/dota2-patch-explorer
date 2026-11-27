const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { compareRanks } = require("../docs/standardize.js");

const context = { window: {} };
const dataPath = path.join(__dirname, "../docs/data.js");
vm.runInNewContext(fs.readFileSync(dataPath, "utf8"), context);
const { patches } = context.window.PATCH_DATA;
const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);

function checkRow(row) {
  assert.ok(Number.isSafeInteger(row.n) && row.n >= 0);
  if (row.wins !== null) {
    assert.ok(Number.isSafeInteger(row.wins) && row.wins >= 0 && row.wins <= row.n);
  }
  if (row.n === 0) return assert.equal(row.radiantPct, null);
  assert.ok(Number.isFinite(row.radiantPct) && row.radiantPct >= 0 && row.radiantPct <= 100);
  if (row.wins !== null) assert.ok(Math.abs(row.radiantPct - 100 * row.wins / row.n) <= 0.005001);
}

test("patch IDs are unique and comparable", () => {
  assert.ok(patches.length >= 2);
  assert.equal(new Set(patches.map(patch => patch.id)).size, patches.length);
});

for (const patch of patches) {
  test(`patch ${patch.id}: counts reconcile for all published filters`, () => {
    checkRow(patch.total);
    for (const [field, keys] of [["duration", ["20-30", "30-40", "40+"]], ["rank", ["low", "mid", "high"]]]) {
      const rows = patch[field];
      assert.deepEqual(Array.from(rows, row => row.key).sort(), keys.sort());
      rows.forEach(checkRow);
      assert.equal(sum(rows, "n"), patch.total.n);
      if (rows.every(row => row.wins !== null)) assert.equal(sum(rows, "wins"), patch.total.wins);
      if (patch.joint === null) continue;
      assert.equal(patch.joint.length, 9);
      patch.joint.forEach(checkRow);
      for (const row of rows) {
        const cells = patch.joint.filter(cell => cell[field] === row.key);
        assert.equal(cells.length, 3);
        assert.equal(new Set(cells.map(cell => cell[field === "rank" ? "duration" : "rank"])).size, 3);
        assert.equal(sum(cells, "n"), row.n);
        assert.equal(sum(cells, "wins"), row.wins);
      }
    }
  });
}

test("a shared rank mix reproduces the weighted win rates", () => {
  const rows = [
    { patch: "A", rank: "low", n: 20, radiantWins: 8 },
    { patch: "A", rank: "high", n: 80, radiantWins: 48 },
    { patch: "B", rank: "low", n: 80, radiantPct: 50 },
    { patch: "B", rank: "high", n: 20, radiantPct: 60 },
  ];
  const result = compareRanks(rows, "A", "B");
  assert.ok(Math.abs(result.oldRate - 0.5) < 1e-10);
  assert.ok(Math.abs(result.newRate - 0.55) < 1e-10);
  assert.ok(Math.abs(result.deltaPP - 5) < 1e-10);
  assert.equal(result.approximate, true);
});
