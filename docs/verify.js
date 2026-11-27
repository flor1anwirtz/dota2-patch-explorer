"use strict";

const REPOSITORY = "https://github.com/flor1anwirtz/dota2-patch-explorer";
const COUNT_LABELS = ["Matches", "Radiant wins", "Dire wins", "Radiant rate"];
const FORMAT = new Intl.NumberFormat("en-US");

function validDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const timestamp = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date;
}

function patchWindows(date, patches) {
  const start = Date.parse(date + "T00:00:00Z") / 1000;
  const end = start + 86400;
  return patches.flatMap((patch, i) => {
    const from = Math.max(patch.start, start);
    const to = Math.min(patches[i + 1]?.start ?? end, end);
    return from < to ? [{ name: patch.name, from, to }] : [];
  });
}

function verifyManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.days) ||
      !manifest.days.length || !Array.isArray(manifest.patches) || !manifest.patches.length ||
      (manifest.sourceCommit != null && !/^[a-f0-9]{40}$/.test(manifest.sourceCommit))) {
    throw new Error("Unrecognized archive index.");
  }
  const patchNames = new Set();
  manifest.patches.forEach((patch, i) => {
    if (!patch || !/^\d+\.\d+$/.test(patch.name) || patchNames.has(patch.name) ||
        !Number.isSafeInteger(patch.start) || (i && patch.start <= manifest.patches[i - 1].start)) {
      throw new Error("Invalid patch timeline.");
    }
    patchNames.add(patch.name);
  });
  manifest.days.forEach((day, i) => {
    if (!day || !validDate(day.date) || (i && day.date <= manifest.days[i - 1].date) ||
        day.csv !== "verify-data/" + day.date + ".csv" || !/^[a-f0-9]{64}$/.test(day.sha256) ||
        !Array.isArray(day.patches) || !day.patches.length) throw new Error("Invalid archive day.");
    const windows = patchWindows(day.date, manifest.patches);
    let n = 0;
    let wins = 0;
    const seen = new Set();
    for (const part of day.patches) {
      if (!part || !windows.some(w => w.name === part.patch) || seen.has(part.patch) ||
          !Number.isSafeInteger(part.n) || part.n <= 0 || !Number.isSafeInteger(part.radiantWins) ||
          part.radiantWins < 0 || part.radiantWins > part.n) throw new Error("Invalid patch totals.");
      seen.add(part.patch);
      n += part.n;
      wins += part.radiantWins;
    }
    if (n !== day.n || wins !== day.radiantWins) throw new Error("The archive totals disagree.");
  });
  return manifest;
}

function dailySQL(windows) {
  const queries = windows.map(w => [
    "SELECT '" + w.name + "' AS patch,",
    "       COUNT(*) AS matches,",
    "       COUNT(*) FILTER (WHERE radiant_win) AS radiant_wins",
    "FROM public_matches",
    "WHERE lobby_type = 7 AND radiant_win IS NOT NULL",
    "  AND start_time >= " + w.from + " AND start_time < " + w.to
  ].join("\n"));
  return queries.join("\nUNION ALL\n") + (queries.length > 1 ? "\nORDER BY patch" : "") + ";";
}

function sourceComparison(day, windows, response) {
  if (!response || response.err || !Array.isArray(response.rows) ||
      response.rows.length !== windows.length || Number(response.rowCount) !== windows.length) {
    throw new Error("OpenDota returned an incomplete count.");
  }
  const numbers = value => {
    if ((typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) ||
        !Number.isSafeInteger(Number(value)) || Number(value) < 0) {
      throw new Error("OpenDota returned an invalid match count.");
    }
    return Number(value);
  };
  const source = new Map();
  for (const row of response.rows) {
    if (!row || !windows.some(w => w.name === row.patch) || source.has(row.patch)) {
      throw new Error("OpenDota returned unexpected patch labels.");
    }
    const n = numbers(row.matches);
    const wins = numbers(row.radiant_wins);
    if (wins > n) throw new Error("OpenDota returned more wins than matches.");
    source.set(row.patch, { n, wins });
  }
  const differences = [];
  let n = 0;
  let wins = 0;
  for (const w of windows) {
    const expected = day.patches.find(p => p.patch === w.name) ?? { n: 0, radiantWins: 0 };
    const observed = source.get(w.name);
    n += observed.n;
    wins += observed.wins;
    if (expected.n !== observed.n || expected.radiantWins !== observed.wins) {
      differences.push({ patch: w.name, expected, observed });
    }
  }
  return { n, wins, differences };
}

function clock(second, day, end) {
  const midnight = Date.parse(day + "T00:00:00Z") / 1000;
  if (end && second === midnight + 86400) return "24:00";
  const hhmmss = new Date(second * 1000).toISOString().slice(11, 19);
  return hhmmss.endsWith(":00") ? hhmmss.slice(0, 5) : hhmmss;
}

function mountAudit() {
  const $ = id => document.getElementById(id);
  const select = $("archive-date");
  const byDate = new Map();
  let manifest;
  let serial = 0;
  let copyTimer;
  let sourceController;

  function setHash(status, detail, kind) {
    $("hash-status").textContent = status;
    $("hash-status").dataset.kind = kind;
    $("hash-detail").textContent = detail;
  }

  async function validateBytes(day, revision) {
    setHash("Checking CSV…", "Comparing the downloaded bytes with the archived SHA-256.", "pending");
    try {
      const response = await fetch(day.csv, { cache: "no-cache" });
      if (!response.ok) throw new Error("The CSV could not be downloaded.");
      const bytes = await response.arrayBuffer();
      if (revision !== serial) return;
      if (!window.crypto?.subtle) throw new Error("This browser needs HTTPS to calculate the SHA-256.");
      const digest = new Uint8Array(await window.crypto.subtle.digest("SHA-256", bytes));
      if (revision !== serial) return;
      const actual = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
      if (actual === day.sha256) {
        setHash("Checksum matched", "The downloaded CSV is byte-for-byte identical to this archive entry.", "ok");
      } else {
        $("actual-hash").textContent = actual;
        $("actual-digest").hidden = false;
        setHash("Checksum mismatch", "The downloaded CSV differs from the recorded file. Refresh or compare its GitHub revision.", "error");
      }
    } catch (error) {
      if (revision === serial) setHash("Check unavailable", error.message || "The CSV could not be checked.", "error");
    }
  }

  function sourceStatus(title, detail, kind, differences = []) {
    const status = $("source-result");
    status.dataset.kind = kind;
    $("source-title").textContent = title;
    $("source-detail").textContent = detail;
    const lines = differences.map(({patch, expected, observed}) => {
      const li = document.createElement("li");
      li.textContent = "Patch " + patch + " · Archive: " + FORMAT.format(expected.n) + " matches, " +
        FORMAT.format(expected.radiantWins) + " Radiant wins. OpenDota: " + FORMAT.format(observed.n) +
        " matches, " + FORMAT.format(observed.wins) + " Radiant wins.";
      return li;
    });
    $("source-differences").replaceChildren(...lines);
    $("source-differences").hidden = !lines.length;
    status.hidden = false;
  }

  async function compareSource() {
    const button = $("compare-source");
    if (button.disabled) return;
    const revision = serial;
    const day = manifest.days[byDate.get(select.value)];
    const controller = new AbortController();
    sourceController = controller;
    button.disabled = true;
    sourceStatus("Querying OpenDota…", "Counting this UTC day in the public ranked match database.", "pending");
    const timer = window.setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch($("query-link").href, { cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        if (response.status === 429) throw new Error("OpenDota is rate limiting requests.");
        if ([408, 504].includes(response.status)) throw new Error("The OpenDota query timed out.");
        throw new Error("OpenDota returned HTTP " + response.status + ".");
      }
      const json = await response.json();
      if (revision !== serial) return;
      const result = sourceComparison(day, patchWindows(day.date, manifest.patches), json);
      if (!result.differences.length) {
        sourceStatus("Patch totals match", "OpenDota returned " + FORMAT.format(result.n) + " matches and " +
          FORMAT.format(result.wins) + " Radiant wins. Every patch row agrees with the archive.", "ok");
      } else {
        sourceStatus(result.n ? "Patch totals differ" : "OpenDota returned zero matches",
          result.n ? "The live counts below differ from the saved CSV. Use the R check to locate the affected groups." :
            "This day may be outside the source’s retained history. The saved counts are shown below.",
          "difference", result.differences);
      }
    } catch (error) {
      if (revision !== serial) return;
      const reason = error.name === "AbortError" ? "The request timed out." :
        error instanceof TypeError ? "The source could not be reached from this browser." : error.message;
      sourceStatus("Source check unavailable", reason + " Open the API JSON or run the R command below.", "unavailable");
    } finally {
      window.clearTimeout(timer);
      if (revision === serial) {
        sourceController = null;
        button.disabled = false;
      }
    }
  }

  function rowForWindow(window, day) {
    const part = day.patches.find(patch => patch.patch === window.name) ?? { n: 0, radiantWins: 0 };
    const row = document.createElement("tr");
    const heading = document.createElement("th");
    heading.scope = "row";
    heading.append("Patch " + window.name);
    const time = document.createElement("small");
    time.textContent = clock(window.from, day.date, false) + " – " + clock(window.to, day.date, true);
    heading.append(time);
    row.append(heading);
    const rate = part.n ? (100 * part.radiantWins / part.n).toFixed(2) + "%" : "—";
    [FORMAT.format(part.n), FORMAT.format(part.radiantWins), FORMAT.format(part.n - part.radiantWins), rate]
      .forEach((value, i) => {
        const cell = document.createElement("td");
        cell.dataset.label = COUNT_LABELS[i];
        cell.textContent = value;
        row.append(cell);
      });
    return row;
  }

  function showDate(date, updateUrl = false) {
    const index = byDate.get(date);
    const day = manifest.days[index];
    sourceController?.abort();
    sourceController = null;
    $("compare-source").disabled = false;
    $("source-result").hidden = true;
    select.value = date;
    $("prev-day").disabled = index === 0;
    $("next-day").disabled = index === manifest.days.length - 1;
    $("metric-n").textContent = FORMAT.format(day.n);
    $("metric-rad").textContent = FORMAT.format(day.radiantWins);
    $("metric-dire").textContent = FORMAT.format(day.n - day.radiantWins);
    const windows = patchWindows(date, manifest.patches);
    $("patch-values").replaceChildren(...windows.map(w => rowForWindow(w, day)));
    const sql = dailySQL(windows);
    $("audit-sql").textContent = sql;
    $("r-command").textContent = "Rscript scripts/verify_day.R " + date;
    const target = new URL("https://api.opendota.com/api/explorer");
    target.searchParams.set("sql", sql);
    $("query-link").href = target.href;
    $("expected-hash").textContent = day.sha256;
    $("actual-digest").hidden = true;
    $("download-csv").href = day.csv;
    $("download-csv").download = date + ".csv";
    $("github-file").href = REPOSITORY + "/blob/" + (manifest.sourceCommit ?? "main") + "/data/live/" + date + ".csv";
    $("github-file").title = manifest.sourceCommit ? "View the saved Git revision" : "View the current file on GitHub";
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set("date", date);
      window.history.pushState(null, "", url);
      $("date-note").hidden = true;
    }
    validateBytes(day, ++serial);
  }

  function readDateUrl() {
    const requested = new URL(window.location.href).searchParams.get("date");
    const available = byDate.has(requested);
    const note = $("date-note");
    const latest = manifest.days[manifest.days.length - 1].date;
    note.hidden = !requested || available;
    if (!note.hidden) note.textContent = "This date is outside the saved archive. Showing " + latest + " UTC.";
    showDate(available ? requested : latest);
  }

  async function copyCode(id, button) {
    const code = $(id);
    const status = $("copy-status");
    try {
      await navigator.clipboard.writeText(code.textContent);
      const original = button.dataset.label || button.textContent;
      button.dataset.label = original;
      button.textContent = "Copied";
      window.setTimeout(() => { button.textContent = original; }, 1500);
      status.textContent = "Copied to clipboard.";
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = "Text selected. Use your device’s copy command.";
      button.textContent = "Text selected";
      window.setTimeout(() => { button.textContent = id === "audit-sql" ? "Copy SQL" : "Copy command"; }, 1800);
    }
    window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => { status.textContent = ""; }, 2200);
  }

  async function start() {
    try {
      const response = await fetch("audit-days.json", { cache: "no-cache" });
      if (!response.ok) throw new Error("Could not download the archive index.");
      manifest = verifyManifest(await response.json());
      manifest.days.forEach((day, i) => { byDate.set(day.date, i); });
      for (const day of manifest.days.slice().reverse()) {
        select.add(new Option(day.date, day.date));
      }
      select.addEventListener("change", () => showDate(select.value, true));
      $("prev-day").addEventListener("click", () => showDate(manifest.days[byDate.get(select.value) - 1].date, true));
      $("next-day").addEventListener("click", () => showDate(manifest.days[byDate.get(select.value) + 1].date, true));
      window.addEventListener("popstate", readDateUrl);
      $("compare-source").addEventListener("click", compareSource);
      $("copy-sql").addEventListener("click", event => copyCode("audit-sql", event.currentTarget));
      $("copy-r").addEventListener("click", event => copyCode("r-command", event.currentTarget));
      $("load-message").hidden = true;
      $("audit-report").hidden = false;
      readDateUrl();
    } catch (error) {
      const message = $("load-message");
      message.textContent = error.message + " ";
      const link = document.createElement("a");
      link.href = REPOSITORY + "/tree/main/data/live";
      link.textContent = "Browse the archive on GitHub.";
      message.append(link);
      message.hidden = false;
    }
  }
  start();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { validDate, patchWindows, verifyManifest, dailySQL, clock, sourceComparison };
}
if (typeof document !== "undefined") mountAudit();
