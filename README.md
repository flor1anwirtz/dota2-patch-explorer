# Dota 2 Patch Explorer

Did Radiant’s advantage change between patches 7.41 and 7.42? In 1,438,598 sampled ranked matches lasting at least 20 minutes, Radiant’s win rate fell from **53.01% to 50.56%**. The explorer lets you see how that result changes with match length and rank.

## Open the explorer

Download and extract the repository, then open `docs/index.html` in a browser. Keep the folder together to use it offline. [Explorer entry point](docs/index.html)

1. Choose the **First patch** and **Second patch**. The change in win rate is calculated as the second patch minus the first.
2. Under **Final duration**, select **20 to &lt;30 min**. Radiant won **61.82%** of these games in 7.41 and **56.65%** in 7.42. For games that lasted 40 minutes or longer, Dire led in both samples.
3. Keep that duration and select **Herald to Crusader** under **Rank group**. Radiant won **10,607 of 16,912** games (62.72%) in 7.41 and **3,480 of 5,976** (58.23%) in 7.42. Use **Clear filters** to return to the full sample.

## What the samples cover

| Patch label | Observed dates (UTC) | Eligible matches | Radiant wins | Dire wins | Mean duration |
| --- | --- | ---: | ---: | ---: | ---: |
| 7.41 | Sep 13–23, 2026 | 938,598 | 497,596 | 441,002 | 41.17 min |
| 7.42 | Nov 22–23, 2026 | 500,000 | 252,781 | 247,219 | 41.96 min |

Both original match files supply exact game and win counts for all nine duration-by-rank combinations in each patch. The explorer includes those counts and works without the raw files.

Rank standardization gives both patches the same rank mix. The explorer pools both full samples to calculate fixed weights for Herald–Crusader, Archon–Ancient and Divine/Immortal, then applies them to each patch’s rank-specific rates. Radiant’s win rate fell by approximately **2.44 percentage points** with those weights, compared with **2.46 points** in the raw totals.

Snapshot filenames supply the patch labels. The samples cover different dates, and individual players can appear more than once. Duration groups describe games that ended within each interval. These data alone cannot isolate a patch effect or predict a player’s odds at the draft. [Read the research report](docs/report.html) · [Quarto source](report.qmd) · [Original notebook](notebooks/patch_comparison_original.ipynb) · [Archived results](results/archived/README.md)

## Rebuild from match records

To regenerate the published comparison, place the two original CSVs in `data/raw/` as `7.41dota2.csv` and `7.42dota2.csv`. Run the following from the repository root with R 4.1 or newer. [Input fields and eligibility rules](data/README.md)

```sh
Rscript install_packages.R
Rscript scripts/05_export_explorer.R
```

The R exporter was run on both full CSVs to build the included `docs/data.js`. After a rebuild, reopen the explorer to view the new counts. To include another patch, pass all desired snapshots.

```sh
Rscript scripts/05_export_explorer.R --output=docs/data.js 7.41=data/raw/7.41dota2.csv 7.42=data/raw/7.42dota2.csv 7.43=data/raw/7.43dota2.csv
```

For the research tables, tests and static figures, run `Rscript run_analysis.R`. A full run with R 4.5.0 reproduced both patches’ archived sample sizes, win totals and reported p-values. The command writes its outputs and R session information to `results/generated/`.

## Publish on GitHub Pages

Push the repository to GitHub. In **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, select **main** and **/docs**, then save. GitHub displays the site address when deployment finishes.
