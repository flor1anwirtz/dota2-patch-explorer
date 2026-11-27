const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { build } = require("../scripts/audit_manifest.cjs");

const day = "2026-03-24";
const dayFile = day + ".csv";
const midnight = Date.parse(day + "T00:00:00Z") / 1000;
const timeline = "name,time\n7.40," + (midnight - 300) + "\n7.41," + (midnight + 60) + "\n";
const dayCsv = "patch,duration_band,rank_band,n,wins\n7.40,short,low,3,2\n7.41,40+,unknown,7,3\n";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ranked-archive-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const source = path.join(root, "data/live", dayFile);
  fs.mkdirSync(path.dirname(source), {recursive: true});
  fs.writeFileSync(source, dayCsv);
  fs.writeFileSync(path.join(root, "data/live-patches.csv"), timeline);
  return {root, source, output: path.join(root,"docs/verify-data",dayFile)};
}

test("offline audit verifies exact bytes, both release-day group totals, and detects tampering", t => {
  const {root, source, output} = fixture(t);
  const m = build(root);
  const expected = createHash("sha256").update(dayCsv).digest("hex");
  assert.equal(m.sourceCommit, null);
  assert.deepEqual(m.days, [{date: day, sha256: expected, csv: "verify-data/" + dayFile,
    n: 10, radiantWins: 5, patches: [{patch: "7.40", n: 3, radiantWins: 2}, {patch: "7.41", n: 7, radiantWins: 3}]}]);
  assert.equal(m.patches[1].start, midnight + 60);
  assert.equal(fs.readFileSync(output, "utf8"), dayCsv);
  const first = fs.readFileSync(path.join(root,"docs/audit-days.json"));
  assert.deepEqual(build(root, true), m);
  build(root);
  assert.deepEqual(fs.readFileSync(path.join(root,"docs/audit-days.json")), first);
  fs.appendFileSync(output,"\n");
  assert.throws(() => build(root, true), /Audit mismatch/);
  fs.writeFileSync(output,dayCsv);
  fs.writeFileSync(source, dayCsv.replace("3,2", "3,3"));
  assert.throws(() => build(root, true), /Audit mismatch/);
  fs.writeFileSync(source, dayCsv + "7.40,short,low,3,2\n");
  assert.throws(() => build(root), /duplicate/);
});

test("the manifest identifies only a Git revision containing its complete byte-level inputs", t => {
  const {root, source, output} = fixture(t);
  const git = (...args) => execFileSync("git", ["-C",root,...args], {encoding:"utf8", stdio:["ignore","pipe","pipe"]}).trim();
  git("init","-q");
  git("config","user.name","Fixture");
  git("config","user.email","fixture@example.invalid");
  git("config","core.autocrlf","false");
  git("add","data");
  git("commit","-qm","Fixture data");
  const head = git("rev-parse","HEAD");
  assert.equal(build(root,false,head).sourceCommit, head);
  fs.writeFileSync(source, dayCsv.replaceAll("\n","\r\n"));
  assert.equal(build(root,false,head).sourceCommit, head);
  assert.equal(fs.readFileSync(output,"utf8"), dayCsv);
  fs.writeFileSync(source, dayCsv.replace("7,3","8,3"));
  assert.equal(build(root).sourceCommit,null);
  assert.throws(() => build(root,false,head), /do not match/);
});
