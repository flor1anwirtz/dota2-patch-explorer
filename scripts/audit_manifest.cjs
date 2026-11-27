#!/usr/bin/env node
// Build downloadable day archives and their integrity manifest without network access.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");

const archiveDir = "data/live";
const timelineFile = "data/live-patches.csv";
const downloadDir = "verify-data";
const dayName = /^\d{4}-\d{2}-\d{2}\.csv$/;
const durationBands = new Set(["short", "20-30", "30-40", "40+", "unknown"]);
const rankBands = new Set(["low", "mid", "high", "unknown"]);

function revision(root) {
  const git = (...args) => execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024
  });
  try {
    if (fs.realpathSync(git("rev-parse", "--show-toplevel").trim()) !== fs.realpathSync(root)) return null;
    const commit = git("rev-parse", "HEAD").trim();
    const objects = new Map();
    const tree = git("ls-tree", "-rz", commit, "--", archiveDir, timelineFile);
    for (const entry of tree.split("\0").filter(Boolean)) {
      const [modeTypeObject, name] = entry.split("\t");
      if (name === timelineFile || name.endsWith(".csv")) {
        objects.set(name, modeTypeObject.split(" ")[2]);
      }
    }
    return {commit, objects};
  } catch {
    // An extracted source ZIP can still be checked locally.
    return null;
  }
}

function gitBlobId(bytes, hashLength) {
  return createHash(hashLength === 64 ? "sha256" : "sha1")
    .update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}

function csvRows(bytes, expectedHeader, filename) {
  // The fixed archive schema uses enum labels and numbers. It has no embedded commas.
  const lines = bytes.toString("utf8").trimEnd().split(/\r?\n/);
  const values = line => line.split(",").map(x => x.replace(/^"([^"]*)"$/, "$1"));
  if (values(lines[0]).join(",") !== expectedHeader || lines.length < 2) {
    throw Error("Invalid archive header or empty table in " + filename);
  }
  return lines.slice(1).map(values);
}

function readPatches(bytes) {
  const rows = csvRows(bytes, "name,time", timelineFile);
  const patches = [];
  for (const [index, fields] of rows.entries()) {
    const [name, timestamp] = fields;
    const start = Number(timestamp);
    if (fields.length !== 2 || !/^\d+\.\d+$/.test(name) || !/^\d+$/.test(timestamp) ||
        !Number.isSafeInteger(start) || (index === 0 ? name !== "7.40" : start <= patches[index - 1].start) ||
        patches.some(patch => patch.name === name)) throw Error("Invalid patch boundary in " + timelineFile);
    patches.push({name, start});
  }
  return patches;
}

function summarize(bytes, file, timeline) {
  const date = file.slice(0, -4);
  const ms = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0,10) !== date) throw Error("Invalid UTC date " + file);
  const start = ms / 1000;
  const patches = timeline.filter((p, i) => p.start < start + 86400 &&
    (i + 1 === timeline.length || timeline[i + 1].start > start))
    .map(p => ({patch: p.name, n: 0, radiantWins: 0}));
  const totals = new Map(patches.map(p => [p.patch, p]));
  const seen = new Set();
  let n = 0;
  let radiantWins = 0;
  for (const fields of csvRows(bytes, "patch,duration_band,rank_band,n,wins", file)) {
    const [patch, duration, rank, gamesText, winsText] = fields;
    const key = [patch, duration, rank].join("/");
    const games = Number(gamesText);
    const wins = Number(winsText);
    if (fields.length !== 5 || !totals.has(patch) || !durationBands.has(duration) || !rankBands.has(rank) ||
        seen.has(key) || !/^\d+$/.test(gamesText) || !/^\d+$/.test(winsText) ||
        !Number.isSafeInteger(games) || !Number.isSafeInteger(wins) || wins > games) {
      throw Error("Invalid or duplicate count in " + file + ": " + fields.join(","));
    }
    seen.add(key);
    totals.get(patch).n += games;
    totals.get(patch).radiantWins += wins;
    n += games;
    radiantWins += wins;
  }
  if (n <= 0 || !Number.isSafeInteger(n)) throw Error("Invalid daily match count in " + file);
  return {date, sha256: createHash("sha256").update(bytes).digest("hex"),
    csv: downloadDir + "/" + file, n, radiantWins, patches};
}

function build(root, checkOnly = false, expectedCommit = null) {
  const files = fs.readdirSync(path.join(root, archiveDir)).filter(x => x.endsWith(".csv")).sort();
  if (!files.length || files.some(x => !dayName.test(x))) throw Error("Missing or invalid daily archive filename");
  const rev = revision(root);
  let matchesHead = !!rev && rev.objects.size === files.length + 1;
  function sourceBytes(name) {
    const bytes = fs.readFileSync(path.join(root, name));
    const id = rev?.objects.get(name);
    if (id && gitBlobId(bytes, id.length) === id) return bytes;
    // Windows checkouts may expand LF to CRLF. Serve the actual Git bytes if the
    // normalized local data hash to that exact blob.
    if (id && bytes.includes(13)) {
      const lf = Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"));
      if (gitBlobId(lf, id.length) === id) return lf;
    }
    matchesHead = false;
    return bytes;
  }
  const patches = readPatches(sourceBytes(timelineFile));
  const data = files.map(file => {
    const bytes = sourceBytes(archiveDir + "/" + file);
    return {file, bytes, day: summarize(bytes, file, patches)};
  });
  const sourceCommit = matchesHead ? rev.commit : null;
  if (expectedCommit && sourceCommit !== expectedCommit) throw Error("Archived bytes do not match the requested Git commit.");
  const days = data.map(x => x.day);
  const manifest = {schemaVersion: 1, sourceCommit, patches, days};
  const encoded = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  const output = path.join(root, "docs", downloadDir);
  const manifestFile = path.join(root, "docs", "audit-days.json");
  if (!checkOnly) fs.mkdirSync(output, {recursive: true});
  const generated = fs.readdirSync(output).filter(x => x.endsWith(".csv"));
  const keep = new Set(files);
  for (const name of generated.filter(x => !keep.has(x))) {
    if (checkOnly || !dayName.test(name)) throw Error("Unexpected downloadable CSV: " + name);
    fs.unlinkSync(path.join(output, name));  // Only generated calendar-date CSVs.
  }
  function outputFile(dest, content) {
    if (checkOnly) {
      if (!fs.readFileSync(dest).equals(content)) throw Error("Audit mismatch: " + dest);
    } else {
      fs.writeFileSync(dest, content);
    }
  }
  for (const entry of data) outputFile(path.join(output, entry.file), entry.bytes);
  outputFile(manifestFile, encoded);
  return manifest;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length && args[0] !== "--check")) throw Error("Usage: node scripts/audit_manifest.cjs [--check]");
    const result = build(path.resolve(__dirname, ".."), args[0] === "--check", process.env.AUDIT_SOURCE_SHA);
    console.log((args.length ? "Verified " : "Built ") + result.days.length + " daily CSVs and their SHA-256 manifest.");
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
module.exports = {build};
