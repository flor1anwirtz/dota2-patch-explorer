# Project history

## Interactive patch explorer

- Added a static, offline-capable explorer for the 7.41 and 7.42 samples, with duration and rank filters and shareable filtered views.
- Added a comparison that weights both samples to the same pooled rank distribution.
- Rebuilt both patches from the supplied match records. The explorer includes exact Radiant wins and match counts for every duration and rank group, including all 18 joint cells. The 7.42 snapshot contains 500,000 matches.
- Verified the complete R 4.5.0 analysis against both full snapshots, including the archived match totals and p-values.
- Added an R exporter for new local snapshots and data consistency checks that run with `node --test tests/data.test.cjs`.

## Earlier R analysis

- Split the original R notebook into data cleaning, statistical analysis, and visualization scripts.
- Incorporated the previously supplied OpenDota collector; added a configurable page size (default 1,000).
- Retained the original eligible rank codes, duration cutoff, tests, and chart designs.
- Archived the original notebook outputs; added a supplementary change-in-proportion interval
  computed from the archived counts and code to recompute it.
- Added a check for invalid timestamps and a clear error for missing historical CSVs.
- Made large cleaned exports optional and separated generated outputs from archived results.
- Added an English README, data documentation, and a Quarto report draft.
- Recorded results from the original notebook before the full historical CSVs became available. Its original package versions were not recorded.
