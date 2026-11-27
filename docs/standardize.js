/* Directly standardize two patches to their combined rank distribution. */
(function (root) {
  "use strict";

  function readBand(row) {
    if (!Number.isSafeInteger(row.n) || row.n < 1) {
      throw new Error("Each rank band must contain at least one match in both patches.");
    }
    if (row.radiantWins != null) {
      if (!Number.isSafeInteger(row.radiantWins) || row.radiantWins < 0 || row.radiantWins > row.n) {
        throw new Error("Radiant wins must be a whole number from zero to the match count.");
      }
      return { n: row.n, rate: row.radiantWins / row.n, approximate: false };
    }
    if (!Number.isFinite(row.radiantPct) || row.radiantPct < 0 || row.radiantPct > 100) {
      throw new Error("Every rank band needs Radiant wins or a percentage from 0 to 100.");
    }
    return { n: row.n, rate: row.radiantPct / 100, approximate: true };
  }

  function collectPatch(rows, patch) {
    const bands = new Map();
    for (const row of rows) {
      if (String(row.patch) !== patch) continue;
      if (typeof row.rank !== "string" || !row.rank.trim()) {
        throw new Error("Every rank band needs a name.");
      }
      if (bands.has(row.rank)) {
        throw new Error("Supply one row per patch and rank band.");
      }
      bands.set(row.rank, readBand(row));
    }
    return bands;
  }

  function compareRanks(rows, oldPatch, newPatch) {
    const patches = [...new Set(rows.map(row => String(row.patch)))];
    patches.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    oldPatch = String(oldPatch ?? patches[0]);
    newPatch = String(newPatch ?? patches[patches.length - 1]);
    if (oldPatch === newPatch || !patches.includes(oldPatch) || !patches.includes(newPatch)) {
      throw new Error("Select two distinct patches with rank data.");
    }

    const older = collectPatch(rows, oldPatch);
    const newer = collectPatch(rows, newPatch);
    if (older.size !== newer.size || [...older.keys()].some(rank => !newer.has(rank))) {
      throw new Error("Both patches must include the same rank bands.");
    }
    let pooledTotal = 0;
    for (const [rank, old] of older) pooledTotal += old.n + newer.get(rank).n;

    const bands = [];
    let oldRate = 0;
    let newRate = 0;
    let approximate = false;
    for (const [rank, old] of older) {
      const next = newer.get(rank);
      const weight = (old.n + next.n) / pooledTotal;
      oldRate += weight * old.rate;
      newRate += weight * next.rate;
      approximate ||= old.approximate || next.approximate;
      bands.push({ rank, nOld: old.n, nNew: next.n, weight, oldRate: old.rate, newRate: next.rate });
    }

    const deltaPP = 100 * (newRate - oldRate);
    const gapImprovementPP = 200 * (Math.abs(oldRate - 0.5) - Math.abs(newRate - 0.5));
    return { oldPatch, newPatch, bands, oldRate, newRate, deltaPP, gapImprovementPP, approximate };
  }

  const api = { compareRanks };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DotaStandardize = api;
})(globalThis);
