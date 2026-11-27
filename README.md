# Dota 2 Patch Explorer

Track how often Radiant and Dire win ranked Dota 2 matches in each major patch from **7.40 onward**. Choose two patches to compare, or use the **All patches** table to see their rates, match counts and coverage side by side. [Open the explorer](https://flor1anwirtz.github.io/dota2-patch-explorer/)

## Read the results

- The tracker counts ranked matches with a known winner in OpenDota's public match database. Each day's query includes every qualifying record available to that query. Collection targets completed UTC days.
- **20+ min** is the default. **All durations** includes short games and matches with an unknown duration. **All ranks** includes games with an unknown average medal. Choose a specific duration or rank to compare the same group across patches.
- A patch's Radiant win rate is its total Radiant wins divided by its total matches under the selected filters. Patch change is the second patch's rate minus the first patch's rate, in percentage points. Major patches include their letter updates. On a release day, each game's start time determines its patch.
- **Days covered** compares the number of archived UTC dates with the number expected for that patch. Dates can be missing during backfill or source outages. The most recent covered date can be later than a gap. Counts cover matches recorded by OpenDota.

To view the win-rate dashboard offline, download and extract this repository and open `docs/index.html`.

## Daily updates

GitHub Actions is scheduled for **09:17 UTC**. The updater queries OpenDota Explorer, refreshes the three most recent completed dates for late records and fills up to eight additional missing dates, oldest first, by default. It saves one aggregate CSV per UTC day in `data/live/`. Reprocessing a date replaces that day's counts. The site loads `docs/live-data.js`, so opening or refreshing the page requires no API calls. [Daily files and column definitions](data/README.md)

Run these commands from the repository root. Install the two R packages once.

```sh
Rscript -e 'install.packages(c("httr", "jsonlite"), repos="https://cloud.r-project.org")'
Rscript scripts/live_update.R
node --test tests/*.cjs
```

To rebuild the site data from the archived days and saved patch timeline without querying matches, use the following command.

```sh
Rscript scripts/live_export.R --timeline=data/live-patches.csv
```

In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**. The workflow validates the counts and deploys the site's `docs/` folder. Open **Actions → Update ranked win rates** to view logs or start a manual run. [Daily workflow](.github/workflows/live.yml)

To resume the initial history through November 26, 2026, select **Fill the initial archive** in the manual workflow. Each batch saves up to eight missing dates. If a run reaches its four-hour time limit, another run picks up from the saved dates. The scheduled updater continues collecting new dates after the initial archive is complete.

## Verify a daily CSV

Pick a UTC date on **Verify a day** to download the archived CSV and check its SHA-256 fingerprint. Select **Compare with OpenDota** to run an independent live count of matches and Radiant wins for each patch that day. On November 25, 2026, the full-day archive counted **431,246** decided ranked matches and **217,669** Radiant wins. The 20+ minute filter counted **428,778** matches and **216,297** Radiant wins. [Verify November 25](https://flor1anwirtz.github.io/dota2-patch-explorer/verify.html?date=2026-11-25)

For the same archived result later, use the Git commit linked on the verification page. From that checkout, these commands check the CSV offline, print the independent SQL, and compare every group against OpenDota. The online comparison also checks a separate full-day count.

```sh
Rscript scripts/verify_day.R 2026-11-25 --offline
Rscript scripts/verify_day.R 2026-11-25 --sql
Rscript scripts/verify_day.R 2026-11-25
```

During daily updates, each newly collected or refreshed CSV goes through a separate query for matches and Radiant wins in each patch window before it can replace the saved file. The checksum identifies the exact published file. The live comparison checks the upstream records available at the time of the rerun. OpenDota can add late records or age out older matches. The archived file and code stay available at the original commit.

## Original 7.41 and 7.42 study

The original report compared fixed samples of **938,598** eligible games in 7.41 and **500,000** in 7.42. Radiant won **53.01%** and **50.56%**, respectively. Those samples cover selected dates, require a known medal, and include only games lasting at least 20 minutes. The historical tables and five figures retain those definitions. [Read the illustrated report](https://flor1anwirtz.github.io/dota2-patch-explorer/report.html) · [Figures](figures/) · [Archived results](results/archived/) · [Original notebook](notebooks/patch_comparison_original.ipynb)

To reproduce the fixed study locally, place the original CSVs in `data/raw/` and run `Rscript run_analysis.R`. [CSV names, checksums and eligibility](data/README.md)

[OpenDota](https://www.opendota.com/) · [OpenDota API](https://docs.opendota.com/)
