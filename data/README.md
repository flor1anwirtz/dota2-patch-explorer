# Data

## Raw inputs and sample sizes

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

The eligible match counts, Radiant wins and observation windows for these two files match the archived notebook. The explorer computes its rates from the exact win counts. [Archived results](../results/archived/README.md)

## Required columns

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

## Eligibility rules

Ranked lobby, duration at least 1,200 seconds, recognized win indicator, positive numeric
match ID string, rank code 11–15, 21–25, ..., 71–75, or exactly 80.
Divine and Immortal are pooled. The original rank rule does not include every code above 80.
Exact duplicate rows are removed, and conflicting IDs or cross-patch overlap stop the pipeline.
The descriptive mean medal averages ordinal medal steps with Immortal mapped to Divine 5.

## Collecting new matches

`Rscript scripts/01_collect_data.R` queries the OpenDota Explorer endpoint and writes a timestamped
CSV to `data/downloads/`. It retrieves recent eligible matches, not the exact historical data.
Explorer availability, access restrictions, and API limits may change. The script has not been
live-tested in this packaging session. API credentials are read from `OPENDOTA_API_KEY`;
never commit credentials. Optional environment variables: `OPENDOTA_TARGET_N`,
`OPENDOTA_PAGE_SIZE`, `OPENDOTA_OUTPUT_DIR`, `OPENDOTA_INPUT_CSV`.

Source: [OpenDota](https://www.opendota.com/) / [API documentation](https://docs.opendota.com/).
Raw snapshots, processed data and downloads are ignored by Git by default.
