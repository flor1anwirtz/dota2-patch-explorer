# Data

## Daily tracker archives

Files named `live/YYYY-MM-DD.csv` contain counts for matches starting on that UTC date. Each row represents a combination of major patch, duration and average rank. The same date can contain two patches. The unique match ID in the source table and disjoint categories allow counts to be added across days.

| Column | Meaning |
| --- | --- |
| `patch` | Major patch label, including its letter updates |
| `duration_band` | `short` for under 20 minutes, `20-30` for 20 to under 30, `30-40` for 30 to under 40, `40+` from 40 minutes, or `unknown` |
| `rank_band` | `low` for Herald through Crusader, `mid` for Archon through Ancient, `high` for Divine and Immortal, or `unknown` |
| `n` | Ranked matches with recorded outcomes in this group |
| `wins` | Radiant wins among those matches. Dire wins equal `n - wins` |

For a filter or patch, sum `wins` and `n` first, then divide the two totals. A missing date indicates incomplete coverage. The historical match-level files described below belong to the earlier two-patch study.

For a byte-for-byte copy, open the selected UTC date on the verification page and follow its Git commit. A live re-query requires that OpenDota still retain that day. The CSV contains grouped counts and can reproduce the dashboard totals without individual match IDs. [Verify a day](https://flor1anwirtz.github.io/dota2-patch-explorer/verify.html)

## Historical study inputs and sample sizes

The project author supplied OpenDota match records for both patch labels. Raw CSVs are excluded from Git. For a local rebuild, place the files in `data/raw/` under the names below, or set `DOTA_PATCH_741_CSV` and `DOTA_PATCH_742_CSV` to their paths.

| Filename | Input rows | Eligible matches | Radiant wins | Observed UTC interval |
| --- | ---: | ---: | ---: | --- |
| `7.41dota2.csv` | 1,029,119 | 938,598 | 497,596 | Sep 13 07:17:31 to Sep 23 06:48:18, 2026 |
| `7.42dota2.csv` | 500,000 | 500,000 | 252,781 | Nov 22 19:30:58 to Nov 23 23:33:38, 2026 |

To identify the exact input files, compare their SHA-256 hashes.

```text
846d71b03893f63d1d98ee3edba2b60eefd36ac6487886be2d095e582b83880a  7.41dota2.csv
f91f69e0eb54dc686216f53e9d21f62fc39206d2b8a4a95b8471bdf1e1fc84cf  7.42dota2.csv
```

Both supplied files support exact counts for every duration and rank combination. Snapshot filenames supply the patch labels. The source files lack an independently verified patch ID.

The eligible match counts, Radiant wins and observation windows for these two files match the archived notebook. The archived study computes its rates from the exact win counts. [Archived results](../results/archived/README.md)

## Historical match columns

| Column | Meaning |
| --- | --- |
| `match_id` | Match identifier, read as text to preserve exact digits |
| `start_time` | Unix timestamp in seconds, reported in UTC |
| `duration` | Match duration in seconds |
| `lobby_type` | Lobby category, 7 for ranked |
| `game_mode` | Game mode identifier, recorded across eligible modes |
| `radiant_win` | Radiant victory indicator (`true`/`false` or `1`/`0`) |
| `avg_rank_tier` | Average rank tier code |
| `num_rank_tier` | Number of player ranks contributing to OpenDota’s average |

## Historical study eligibility

Ranked lobby, duration at least 1,200 seconds, recognized win indicator, positive numeric
match ID string, rank code 11–15, 21–25, ..., 71–75, or exactly 80.
Divine and Immortal are pooled. The original rank rule does not include every code above 80.
Exact duplicate rows are removed, and conflicting IDs or cross-patch overlap stop the pipeline.
The descriptive mean medal averages ordinal medal steps with Immortal mapped to Divine 5.

## Historical collection script

`Rscript scripts/01_collect_data.R` queries the OpenDota Explorer endpoint and writes a timestamped
CSV to `data/downloads/`. This optional script retrieves recent eligible matches for a new snapshot.
Explorer availability, access restrictions, and API limits may change. It reads an optional
API key from `OPENDOTA_API_KEY`. Optional environment variables include `OPENDOTA_TARGET_N`,
`OPENDOTA_PAGE_SIZE`, `OPENDOTA_OUTPUT_DIR`, `OPENDOTA_INPUT_CSV`.

[OpenDota](https://www.opendota.com/) / [API documentation](https://docs.opendota.com/).
Raw snapshots, processed data and downloads are ignored by Git by default.
