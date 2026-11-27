const test = require("node:test");
const assert = require("node:assert/strict");
const { patchWindows, verifyManifest, dailySQL, clock } = require("../docs/verify.js");

const starts = [
  { name: "7.40", start: 1765846241 },
  { name: "7.41", start: 1774313460 },
  { name: "7.42", start: 1795037288 }
];

test("launch day omits games that started before 7.40", () => {
  const windows = patchWindows("2025-12-16", starts);
  assert.deepEqual(windows, [{ name: "7.40", from: starts[0].start, to: Date.parse("2025-12-17T00:00:00Z") / 1000 }]);
  assert.equal(clock(windows[0].to, "2025-12-16", true), "24:00");
});

test("patch switch uses exclusive end and includes exact first second of new patch", () => {
  const windows = patchWindows("2026-11-18", starts);
  assert.equal(windows.length, 2);
  assert.equal(windows[0].to, starts[2].start);
  assert.equal(windows[1].from, starts[2].start);
  assert.equal(windows[1].to - windows[0].from, 86400);
  const query = dailySQL(windows);
  assert.match(query, /UNION ALL/);
  assert.match(query, /start_time < 1795037288/);
  assert.match(query, /start_time >= 1795037288/);
  assert.equal((query.match(/lobby_type = 7 AND radiant_win IS NOT NULL/g) || []).length, 2);
});

test("manifest checks patch dates, per-patch totals and the same-origin CSV location", () => {
  const day = {date:"2026-11-18", sha256:"a".repeat(64), csv:"verify-data/2026-11-18.csv",
    n:412960, radiantWins:216581, patches:[{patch:"7.41", n:378084, radiantWins:199084},
      {patch:"7.42", n:34876, radiantWins:17497}]};
  const manifest = {schemaVersion:1,sourceCommit:null,patches:starts,days:[day]};
  assert.equal(verifyManifest(manifest), manifest);
  for (const wrong of [{n:412961}, {csv:"https://example.org/other.csv"},
    {patches:[{patch:"7.40",n:412960,radiantWins:216581}]}]) {
    assert.throws(() => verifyManifest({...manifest, days:[{...day,...wrong}]}));
  }
});

test("the live comparison catches per-patch drift even when both day totals are identical", () => {
  const { sourceComparison } = require("../docs/verify.js");
  const windows = patchWindows("2026-11-18", starts);
  const day = {patches:[{patch:"7.41", n:100, radiantWins:60}, {patch:"7.42", n:20, radiantWins:9}]};
  const rows = [{patch:"7.41", matches:"100", radiant_wins:"61"}, {patch:"7.42", matches:"20", radiant_wins:"8"}];
  const changes = sourceComparison(day, windows, {rows,rowCount:2});
  assert.equal(changes.n,120);
  assert.equal(changes.wins,69);
  assert.equal(changes.differences.length,2);
  const exact = [{...rows[0],radiant_wins:"60"}, {...rows[1],radiant_wins:"9"}];
  assert.equal(sourceComparison(day, windows, {rows:exact.reverse(),rowCount:2}).differences.length,0);
  assert.throws(() => sourceComparison(day, windows, {rows:[rows[0],rows[0]],rowCount:2}));
  assert.throws(() => sourceComparison(day, windows, {rows:[{...rows[0],radiant_wins:null},rows[1]],rowCount:2}));
});
