(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const data = window.PATCH_DATA;
  if (!data || !Array.isArray(data.patches) || data.patches.length < 2) {
    $("error").hidden = false;
    $("error").textContent = "Two patch samples are needed. Keep data.js in the same folder as this page.";
    return;
  }
  const patches = new Map(data.patches.map(p => [String(p.id), p]));
  const ids = [...patches.keys()];
  const bands = {
    duration: {"20-30": "20 to <30 min", "30-40": "30 to <40 min", "40+": "40+ min"},
    rank: {low: "Herald to Crusader", mid: "Archon to Ancient", high: "Divine / Immortal"}
  };
  const nf = new Intl.NumberFormat("en-US");
  const dformat = new Intl.DateTimeFormat("en-GB", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC"
  });
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
    if (!group || group.n === 0) return null;
    if (Number.isSafeInteger(group.wins) && group.n > 0) return 100 * group.wins / group.n;
    return Number.isFinite(group.radiantPct) ? group.radiantPct : null;
  }
  function pick(patch, duration, rank) {
    if (duration && rank) return patch.joint?.find(g => g.duration === duration && g.rank === rank);
    if (duration) return patch.duration?.find(g => g.key === duration);
    if (rank) return patch.rank?.find(g => g.key === rank);
    return patch.total;
  }
  function loadSelection() {
    const q = new URLSearchParams(location.search);
    const first = patches.has(q.get("first")) ? q.get("first") : ids[0];
    const second = patches.has(q.get("second")) && q.get("second") !== first
      ? q.get("second") : ids.find(id => id !== first);
    return {first, second,
      duration: Object.hasOwn(bands.duration, q.get("duration")) ? q.get("duration") : "",
      rank: Object.hasOwn(bands.rank, q.get("rank")) ? q.get("rank") : "",
      by: q.get("by") === "rank" ? "rank" : "duration"};
  }
  let state = loadSelection();
  function writeSelection() {
    const url = new URL(location.href);
    for (const [key, value] of Object.entries(state)) {
      if (!value || (key === "by" && value === "duration") || (key === "first" && value === ids[0])
          || (key === "second" && value === ids.find(id => id !== state.first))) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    try { history.replaceState(null, "", url.href); } catch { /* Offline files can still be explored. */ }
  }
  function shareRow(patch, group) {
    const r = rate(group);
    const count = Number.isSafeInteger(group?.n) ? nf.format(group.n) + " matches" : "";
    return '<div class="share-row"><div class="share-head"><strong>Patch ' + safe(patch.id) +
      '</strong><span class="count">' + count + '</span></div>' +
      (r === null ? '<p class="na">' + (group?.n === 0 ? 'No matches in this group.' : 'Not available for this combination.') + '</p>' :
       '<div class="share-figures"><span><span class="sr-only">Radiant </span>' + pct(r) +
       '</span><span><span class="sr-only">Dire </span>' + pct(100 - r) +
       '</span></div><div aria-hidden="true" class="stack"><div class="radiant" style="width:' + r +
       '%"></div><div class="dire"></div></div>') + '</div>';
  }
  function renderChange(a, b, aRate, bRate) {
    if (aRate === null || bRate === null) {
      $("change").innerHTML = '<div class="change-value">—</div><p class="change-context">A comparison requires a win rate for each patch.</p>';
      return;
    }
    const delta = bRate - aRate;
    const sideGap = ratePct => Math.abs(2 * ratePct - 100).toFixed(2);
    let detail = 'Side-to-side gap <strong>' + sideGap(aRate) + ' pp → ' + sideGap(bRate) + ' pp</strong>.';
    const ci = data.comparison;
    if (!state.rank && !state.duration && ci && Number.isFinite(ci.lower95Pp) && Number.isFinite(ci.upper95Pp)) {
      const forward = String(ci.from) === String(a.id) && String(ci.to) === String(b.id);
      const reverse = String(ci.from) === String(b.id) && String(ci.to) === String(a.id);
      if (forward || reverse) {
        const low = forward ? ci.lower95Pp : -ci.upper95Pp;
        const high = forward ? ci.upper95Pp : -ci.lower95Pp;
        detail += ' <span class="ci">95% CI ' + pp(low) + ' to ' + pp(high) + ' pp.</span>';
      }
    }
    $("change").innerHTML = '<div class="change-value">' + pp(delta) +
      '<small title="percentage points">pp</small></div><p class="change-context">Patch ' + safe(a.id) +
      ' → Patch ' + safe(b.id) + '</p><p class="change-detail">' + detail + '</p>';
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
    const rows = Object.entries(bands[by]).map(([key,label]) => ({key,label,
       a: select(a,key), b: select(b,key)}));
    const scale = axisRange(rows.flatMap(row => [rate(row.a), rate(row.b)]).filter(Number.isFinite));
    $("by-duration").setAttribute("aria-pressed", by === "duration");
    $("by-rank").setAttribute("aria-pressed", by === "rank");
    $("break-title").textContent = "Radiant win rate by " + (by === "duration" ? "final duration" : "rank group");
    $("break-scope").textContent = (opposite ? "Within " + bands[other][opposite] : by === "duration" ? "All rank groups" : "All final durations") +
      ". The reference line marks 50%.";
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
    if (!window.DotaStandardize || !a.rank?.length || !b.rank?.length) return;
    const rows = [a,b].flatMap(p => p.rank.map(g => ({patch:String(p.id),rank:g.key,n:g.n,
      radiantWins:g.wins,radiantPct:g.radiantPct})));
    let s;
    try { s = window.DotaStandardize.compareRanks(rows, a.id, b.id); } catch { return; }
    const weights = s.bands.map(g => safe(bands.rank[g.rank] || g.rank) + " " + (100*g.weight).toFixed(1) + "%").join(" · ");
    $("std-badge").textContent = pp(s.deltaPP) + " pp";
    $("std-body").innerHTML = '<p>Across all eligible matches, the adjusted Radiant win rate is <strong>' +
      pct(100*s.oldRate) + '</strong> in patch ' + safe(a.id) + ' and <strong>' + pct(100*s.newRate) +
      '</strong> in patch ' + safe(b.id) + ', a change of <strong>' + pp(s.deltaPP) + ' pp</strong>.</p>' +
      '<p>Both patches use the combined sample’s rank distribution. ' + weights + '.</p>' +
      '<p>This calculation uses the full patch samples, regardless of the selected filters.' +
      (s.approximate ? ' Some published rank-group rates were rounded to two decimal places.' : '') + '</p>';
    box.hidden = false;
  }
  function validDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  function renderCoverage(a,b) {
    const lines = [a,b].map(p => {
      const meta = p.metadata || {};
      const from = validDate(meta.firstUtc), to = validDate(meta.lastUtc);
      const range = from && to ? dformat.format(from) + " to " + dformat.format(to) + " UTC" : "Sampling dates unavailable";
      const average = Number.isFinite(meta.meanMinutes) ? " Mean game length " + meta.meanMinutes.toFixed(1) + " min." : "";
      const medal = meta.meanMedal ? " Mean rank " + safe(meta.meanMedal) + "." : "";
      const note = data.sourceNotes?.[p.id];
      return '<p class="coverage-item"><strong>Patch ' + safe(p.id) + '</strong> · ' + range + '.' + average + medal +
        (note ? ' ' + safe(note) : '') + '</p>';
    });
    if (data.sourceNotes?.patchLabels) lines.push('<p>' + safe(data.sourceNotes.patchLabels) + '</p>');
    $("coverage").innerHTML = lines.join("");
    const anyRounded = [a,b].some(p =>
      [p.total, ...(p.duration || []), ...(p.rank || []), ...(p.joint || [])]
        .some(group => !Number.isSafeInteger(group?.wins) && Number.isFinite(group?.radiantPct)));
    $("rate-source").textContent = anyRounded
      ? "Exact win counts determine the rates where available. Other groups use the published percentages."
      : "Win rates use exact match and win counts.";
    const jointMissing = state.duration && state.rank ? [a,b].filter(p => !Array.isArray(p.joint)) : [];
    const notes = [];
    if (jointMissing.length) notes.push("The published data for " + jointMissing.map(p => "patch " + p.id).join(" and ") +
      " do not report wins by rank and duration together. Clear either filter to compare both patches.");
    const spans = [a,b].map(p => {
      const from = validDate(p.metadata?.firstUtc), to = validDate(p.metadata?.lastUtc);
      return from && to ? (to - from) / 3600000 : null;
    });
    if (spans.every(v => v !== null && v > 0) && Math.max(...spans)/Math.min(...spans) >= 3) {
      function timeSpan(hours) { return hours < 24 ? hours.toFixed(1) + " hours" : (hours/24).toFixed(1) + " days"; }
      notes.push("The samples cover different windows. Patch " + a.id + " spans " + timeSpan(spans[0]) +
        " and patch " + b.id + " spans " + timeSpan(spans[1]) + ".");
    }
    $("joint-note").hidden = !notes.length;
    $("joint-note").textContent = notes.join(" ");
  }
  function render() {
    const a = patches.get(state.first), b = patches.get(state.second);
    for (const k of ["first","second","duration","rank"]) $(k).value = state[k];
    $("reset").disabled = !state.duration && !state.rank;
    const ga = pick(a,state.duration,state.rank), gb = pick(b,state.duration,state.rank);
    $("shares").innerHTML = shareRow(a,ga) + shareRow(b,gb);
    renderChange(a,b,rate(ga),rate(gb));
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
  $("reset").addEventListener("click", () => { state.rank = ""; state.duration = ""; update(); });
  window.addEventListener("popstate", () => { state = loadSelection(); render(); });
  $("dashboard").hidden = false;
  render();
})();
