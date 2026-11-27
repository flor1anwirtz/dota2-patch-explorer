(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const data = window.LIVE_DATA;
  if (!data || !Array.isArray(data.patches) || !data.patches.length) {
    $("error").hidden = false;
    $("error").textContent = "The daily match tracker has no published data yet.";
    return;
  }
  const patches = new Map(data.patches.map(p => [String(p.id), p]));
  const ids = [...patches.keys()].sort((a,b) => a.localeCompare(b, "en", {numeric:true}));
  const latest = ids.at(-1);
  const previous = ids.at(-2) || latest;
  const bands = {
    duration: {short: "Under 20 min", "20-30": "20 to <30 min", "30-40": "30 to <40 min", "40+": "40+ min"},
    rank: {low: "Herald to Crusader", mid: "Archon to Ancient", high: "Divine / Immortal", unknown: "Unknown rank"}
  };
  const durations = {all: "All durations", "20plus": "20+ min", ...bands.duration};
  const nf = new Intl.NumberFormat("en-US");
  const dayFormat = new Intl.DateTimeFormat("en-GB", {year: "numeric", month: "short", day: "numeric", timeZone: "UTC"});
  const updateFormat = new Intl.DateTimeFormat("en-GB", {year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC"});
  function displayDay(date, format = dayFormat) {
    if (!date) return "—";
    const parsed = new Date(date);
    return Number.isFinite(parsed.getTime()) ? format.format(parsed) : "—";
  }
  function safe(value) {
    return String(value).replace(/[&<>"']/g, c =>
      ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]);
  }
  const pct = n => n.toFixed(2) + "%";
  function pp(n) {
    const rounded = Number(n.toFixed(2));
    return (rounded > 0 ? "+" : rounded < 0 ? "−" : "") + Math.abs(rounded).toFixed(2);
  }
  function rate(group) {
    return group?.n ? 100 * group.wins / group.n : null;
  }
  function pick(patch, duration, rank) {
    if (!patch.coveredDays || !Array.isArray(patch.cells)) return null;
    const result = {n: 0, wins: 0};
    for (const cell of patch.cells) {
      if (rank && cell.rank !== rank) continue;
      if (duration === "20plus" && !["20-30","30-40","40+"].includes(cell.duration)) continue;
      if (duration !== "all" && duration !== "20plus" && cell.duration !== duration) continue;
      result.n += cell.n;
      result.wins += cell.wins;
    }
    return result;
  }
  function loadSelection() {
    const q = new URLSearchParams(location.search);
    const first = patches.has(q.get("first")) ? q.get("first") : previous;
    const second = patches.has(q.get("second")) && q.get("second") !== first
      ? q.get("second") : first === latest ? previous : latest;
    return {first, second,
      duration: Object.hasOwn(durations, q.get("duration")) ? q.get("duration") : "20plus",
      rank: Object.hasOwn(bands.rank, q.get("rank")) ? q.get("rank") : "",
      by: q.get("by") === "rank" ? "rank" : "duration"};
  }
  let state = loadSelection();
  function writeSelection() {
    const url = new URL(location.href);
    // Explicit patch IDs keep shared comparisons stable when a new patch arrives.
    for (const [key, value] of Object.entries(state)) {
      if (!value || (key === "by" && value === "duration") || (key === "duration" && value === "20plus"))
        url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    try { history.replaceState(null, "", url.href); } catch { /* Offline exploration still works. */ }
  }
  const trackedMatches = [...patches.values()].reduce((total, patch) =>
    total + (pick(patch, "all", "")?.n || 0), 0);
  $("tracked-total").textContent = nf.format(trackedMatches);
  $("tracked-through").textContent = ids.length + (ids.length === 1 ? " patch" : " patches") +
    " · All durations";
  $("hero-stats").hidden = false;

  function shareRow(patch, group) {
    const r = rate(group);
    const count = Number.isSafeInteger(group?.n) ? nf.format(group.n) + " matches" : "";
    const odds = r === null ? '<p class="na">' +
      (group?.n === 0 ? 'No matches in this group.' : 'Awaiting collected match dates.') + '</p>' :
      '<div class="score-line"><strong class="radiant-score"><span class="sr-only">Radiant </span>' + pct(r) +
      '</strong><span aria-hidden="true" class="parity-label">50%</span><strong class="dire-score">' +
      '<span class="sr-only">Dire </span>' + pct(100-r) + '</strong></div>' +
      '<div aria-hidden="true" class="stack"><div class="radiant" style="width:' + r +
      '%"></div><div class="dire"></div></div>';
    return '<div class="share-row"><div class="share-head"><strong>Patch ' + safe(patch.id) +
      '</strong><span class="count">' + count + '</span></div>' + odds + '</div>';
  }
  function wilson(group) {
    const z = 1.95996398454;
    const n = group.n, p = group.wins / n;
    const offset = z * z / n;
    const center = (p + offset / 2) / (1 + offset);
    const radius = z * Math.sqrt((p * (1 - p) + offset / 4) / n) / (1 + offset);
    return [center - radius, center + radius];
  }
  function renderChange(a, b, first, second) {
    const aRate = rate(first), bRate = rate(second);
    if (aRate === null || bRate === null || a.id === b.id) {
      $("change").innerHTML = '<div class="change-value">—</div><p class="change-context">Select two patches with matches in this group to compare.</p>';
      return;
    }
    const delta = bRate - aRate;
    const sideGap = r => Math.abs(2 * r - 100).toFixed(2);
    const [aLow, aHigh] = wilson(first);
    const [bLow, bHigh] = wilson(second);
    const low = delta - Math.hypot(bRate - 100*bLow, 100*aHigh - aRate);
    const high = delta + Math.hypot(100*bHigh - bRate, aRate - 100*aLow);
    $("change").innerHTML = '<p class="change-context">Patch ' + safe(a.id) + ' → Patch ' + safe(b.id) + '</p>' +
      '<div class="change-value">' + pp(delta) +
      '<small title="percentage points">pp</small></div><dl class="change-detail"><div><dt>Side-to-side gap</dt>' +
      '<dd>' + sideGap(aRate) + ' → ' + sideGap(bRate) + ' pp</dd></div>' +
      '<div><dt>95% CI on change</dt><dd>' + pp(low) + ' to ' + pp(high) + ' pp</dd></div></dl>';
  }
  function axisRange(rates) {
    const low = Math.min(50, ...rates), high = Math.max(50, ...rates);
    const span = high - low;
    const step = span > 45 ? 20 : span > 20 ? 10 : span > 6 ? 5 : span > 3 ? 2 : 1;
    let min = Math.max(0, Math.floor((low - step * .2) / step) * step);
    let max = Math.min(100, Math.ceil((high + step * .2) / step) * step);
    if (min === max) { min = Math.max(0, min-step); max = Math.min(100, max+step); }
    const ticks = [];
    for (let v = min; v <= max; v += step) ticks.push(v);
    if (min < 50 && max > 50 && !ticks.includes(50)) ticks.push(50);
    ticks.sort((a,b) => a-b);
    return {min,max,ticks, pos: v => 100 * (v - min) / (max - min)};
  }
  function numericCell(group) {
    const r = rate(group);
    return '<span class="plot-value">' + (r === null ? '<span aria-label="Not available">—</span>' : pct(r)) +
      (Number.isSafeInteger(group?.n) ? '<small>' + nf.format(group.n) + ' games</small>' : '') + '</span>';
  }
  function drawTrack(a, b, scale) {
    const ticks = scale.ticks.map(t => '<i class="tick ' + (t === 50 ? "parity" : "") +
      '" style="left:' + scale.pos(t) + '%"></i>').join("");
    let line = "";
    if (a !== null && b !== null) {
      line = '<i class="link-line" style="left:' + scale.pos(Math.min(a,b)) +
        '%;width:' + Math.abs(scale.pos(a)-scale.pos(b)) + '%"></i>';
    }
    const dot = (v, cls) => v === null ? "" : '<i class="point ' + cls + '" style="left:' + scale.pos(v) + '%"></i>';
    return '<span aria-hidden="true" class="track">' + ticks + line + dot(a, "dot-a") + dot(b, "dot-b") + '</span>';
  }
  function renderBreakdown(a,b) {
    const by = state.by;
    const other = by === "duration" ? "rank" : "duration";
    const opposite = state[other];
    const select = (p, key) => by === "duration" ? pick(p,key,opposite) : pick(p,opposite,key);
    const groups = Object.entries(bands[by]).filter(([key]) =>
      !(by === "duration" && state.duration === "20plus" && key === "short"));
    const rows = groups.map(([key,label]) => ({key,label,
       a: select(a,key), b: select(b,key)}));
    const scale = axisRange(rows.flatMap(row => [rate(row.a), rate(row.b)]).filter(Number.isFinite));
    $("by-duration").setAttribute("aria-pressed", by === "duration");
    $("by-rank").setAttribute("aria-pressed", by === "rank");
    $("break-title").textContent = "Radiant win rate by " + (by === "duration" ? "final duration" : "rank group");
    const scope = by === "rank" ? durations[state.duration] : bands.rank[state.rank] || "All ranks";
    $("break-scope").textContent = scope + ". The reference line marks 50%." +
      (by === "duration" && state.duration === "all" ? " Only known durations are plotted." : "");
    $("patch-legend").innerHTML = '<span><i class="dot-a"></i>Patch ' + safe(a.id) +
      '</span><span><i class="dot-b"></i>Patch ' + safe(b.id) + '</span>';
    const labels = scale.ticks.map((t,i) => '<span aria-hidden="true" class="' +
      (t === 50 ? "parity" : i === 0 || i === scale.ticks.length-1 ? "" : "minor") +
      '" style="left:' + scale.pos(t) + '%">' + t + '%</span>').join("");
    $("break-plot").innerHTML = '<div class="plot-grid plot-head" aria-hidden="true"><span>Group</span><div class="axis">' + labels +
      '</div><span>' + safe(a.id) + '</span><span>' + safe(b.id) + '</span></div>' +
      rows.map(row => '<div class="plot-grid plot-row' + (state[by] === row.key ? ' is-selected' : '') + '">' +
        '<span class="group-name">' + safe(row.label) + '</span>' + drawTrack(rate(row.a),rate(row.b),scale) +
        '<span class="sr-only">Patch ' + safe(a.id) + '</span>' + numericCell(row.a) +
        '<span class="sr-only">Patch ' + safe(b.id) + '</span>' + numericCell(row.b) + '</div>').join("");
    if (rows.some(row => rate(row.a) === null || rate(row.b) === null)) {
      $("break-plot").insertAdjacentHTML("beforeend", '<p class="subtle">A dash means this group has no reported win rate.</p>');
    }
  }
  function renderStandardized(a,b) {
    const box = $("standardization");
    box.hidden = true;
    if (!window.DotaStandardize || a.id === b.id) return;
    const rows = [a,b].flatMap(p => ["low","mid","high"].map(rank => {
      const g = pick(p, state.duration, rank);
      return {patch:String(p.id), rank, n:g?.n, radiantWins:g?.wins};
    }));
    let s;
    try { s = window.DotaStandardize.compareRanks(rows, a.id, b.id); } catch { return; }
    const weights = s.bands.map(g => safe(bands.rank[g.rank] || g.rank) + " " + (100*g.weight).toFixed(1) + "%").join(" · ");
    $("std-badge").textContent = pp(s.deltaPP) + " pp";
    $("std-body").innerHTML = '<p>Among matches with a known rank, the adjusted Radiant win rate is <strong>' +
      pct(100*s.oldRate) + '</strong> in patch ' + safe(a.id) + ' and <strong>' + pct(100*s.newRate) +
      '</strong> in patch ' + safe(b.id) + ', a change of <strong>' + pp(s.deltaPP) + ' pp</strong>.</p>' +
      '<p>Both patches use the combined sample’s rank distribution. ' + weights + '.</p>' +
      '<p>The calculation uses the selected duration range and all three known medal groups.</p>';
    box.hidden = false;
  }
  function coverageText(p) {
    if (!p.coveredDays) return "Awaiting data";
    return p.complete ? "Complete" : "Partial";
  }
  function renderCoverage(a,b) {
    $("updated").textContent = "Updated " + displayDay(data.asOfUtc, updateFormat) +
      " UTC · Match dates through " + displayDay(data.throughDate);
    $("overview-scope").textContent = durations[state.duration] + " · " + (bands.rank[state.rank] || "All ranks");
    $("patch-rows").innerHTML = ids.slice().reverse().map(id => {
      const p = patches.get(id);
      const group = pick(p, state.duration, state.rank);
      const r = rate(group);
      const valueCell = (name, value) => '<td data-label="' + name + '">' + safe(value) + '</td>';
      const covered = p.expectedDays ? Math.min(100, 100*p.coveredDays/p.expectedDays) : 0;
      return '<tr><th scope="row">Patch ' + safe(id) + '</th>' +
        valueCell("Matches", group ? nf.format(group.n) : "—") +
        valueCell("Radiant", r === null ? "—" : pct(r)) + valueCell("Dire", r === null ? "—" : pct(100-r)) +
        '<td data-label="Days covered"><span class="coverage-cell"><span>' +
        safe(p.coveredDays) + '/' + safe(p.expectedDays) + ' · ' + safe(coverageText(p)) +
        '</span><i aria-hidden="true"><b style="width:' + covered + '%"></b></i></span></td>' +
        valueCell("Latest UTC day", displayDay(p.latestDay)) + '</tr>';
    }).join("");
    const selected = a.id === b.id ? [a] : [a,b];
    $("coverage").innerHTML = selected.map(p => '<p class="coverage-item"><strong>Patch ' + safe(p.id) +
      '</strong> · ' + safe(displayDay(p.firstDay)) + ' to ' + safe(displayDay(p.lastDay)) +
      ' UTC. ' + safe(p.coveredDays) + ' of ' + safe(p.expectedDays) + ' dates collected.</p>').join("");
    const gaps = selected.filter(p => !p.complete);
    $("joint-note").hidden = !gaps.length;
    $("joint-note").textContent = gaps.map(p => "Patch " + p.id + " covers " + p.coveredDays +
      " of " + p.expectedDays + " UTC days.").join(" ") +
      (gaps.length ? " Rates use the dates collected so far." : "");
  }
  function render() {
    const a = patches.get(state.first), b = patches.get(state.second);
    for (const k of ["first","second","duration","rank"]) $(k).value = state[k];
    $("reset").disabled = state.duration === "20plus" && !state.rank;
    const ga = pick(a,state.duration,state.rank), gb = pick(b,state.duration,state.rank);
    $("shares").innerHTML = shareRow(a,ga) + (a.id === b.id ? "" : shareRow(b,gb));
    renderChange(a,b,ga,gb);
    renderBreakdown(a,b);
    renderCoverage(a,b);
    renderStandardized(a,b);
    $("status").textContent = [a,b].map((p,i) => {
      const r = rate(i === 0 ? ga : gb);
      return "Patch " + p.id + ", " + (r === null ? "win rate unavailable" : "Radiant " + pct(r));
    }).join(". ") + ".";
  }
  function update() { render(); writeSelection(); }
  for (const side of ["first","second"]) {
    for (const id of ids) $(side).add(new Option("Patch " + id, id));
    $(side).addEventListener("change", () => {
      const other = side === "first" ? "second" : "first";
      const next = $(side).value;
      if (next === state[other]) state[other] = state[side];
      state[side] = next;
      update();
    });
  }
  for (const dim of ["rank","duration"]) {
    $(dim).addEventListener("change", () => { state[dim] = $(dim).value; update(); });
    $("by-" + dim).addEventListener("click", () => { state.by = dim; update(); });
  }
  $("swap").addEventListener("click", () => { [state.first,state.second] = [state.second,state.first]; update(); });
  $("reset").addEventListener("click", () => { state.rank = ""; state.duration = "20plus"; update(); });
  window.addEventListener("popstate", () => { state = loadSelection(); render(); });
  if (ids.length === 1) {
    $("first").disabled = true;
    $("second").disabled = true;
    $("swap").disabled = true;
    $("breakdown").hidden = true;
  }
  $("dashboard").hidden = false;
  render();
})();
