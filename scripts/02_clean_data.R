# Load the two saved snapshots and apply original eligibility rules.
# Historical snapshots: file names assign patch labels; they are not verified patch IDs.
files <- c("7.41" = Sys.getenv("DOTA_PATCH_741_CSV", "data/raw/7.41dota2.csv"),
           "7.42" = Sys.getenv("DOTA_PATCH_742_CSV", "data/raw/7.42dota2.csv"))
if (!all(file.exists(files))) {
  stop("Missing historical CSV(s): ", paste(files[!file.exists(files)], collapse = ", "),
       "\\nSee data/README.md. The collector downloads recent matches, not historical snapshots.")
}
output_dir <- "results/generated"
figure_dir <- file.path(output_dir, "figures")
dir.create(figure_dir, recursive = TRUE, showWarnings = FALSE)
medal_names <- c("Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine", "Immortal")
medal_groups <- c(medal_names[1:6], "Divine / Immortal")
rank_codes <- as.vector(outer(1:5, 10 * (1:7), "+"))
valid_rank_codes <- c(rank_codes, 80L)
min_duration_seconds <- 1200L
duration_bands <- c("20 to <30", "30 to <40", "40+")
rank_bands <- c("Herald to Crusader", "Archon to Ancient", "Divine / Immortal")
match_columns <- c("match_id", "start_time", "duration", "lobby_type", "game_mode",
                   "radiant_win", "avg_rank_tier", "num_rank_tier")

read_sample <- function(path) {
  raw <- read_csv(path, progress = FALSE, col_types = cols(
    .default = col_character(), start_time = col_double(), duration = col_double(),
    lobby_type = col_integer(), avg_rank_tier = col_integer()
  ))
  if (!all(match_columns %in% names(raw))) stop("Missing match columns in ", path)
  ranked <- filter(raw, lobby_type == 7)
  long_enough <- filter(ranked, is.finite(duration), duration >= min_duration_seconds)
  eligible <- long_enough |>
    filter(avg_rank_tier %in% valid_rank_codes, grepl("^[1-9][0-9]*$", match_id),
           tolower(trimws(radiant_win)) %in% c("true", "false", "1", "0")) |>
    distinct()
  if (!nrow(eligible) || anyDuplicated(eligible$match_id)) {
    stop("Empty sample or conflicting match IDs in ", path)
  }
  if (any(!is.finite(eligible$start_time))) stop("Invalid start_time in eligible rows of ", path)
  list(data = eligible,
       audit = tibble(csv_rows = nrow(raw), ranked = nrow(ranked), ranked_20min = nrow(long_enough)))
}

samples <- lapply(files, read_sample)
audit <- bind_rows(lapply(samples, "[[", "audit"), .id = "patch")
matches <- bind_rows(lapply(samples, function(s) select(s$data, all_of(match_columns))), .id = "patch") |>
  mutate(patch = factor(patch, levels = names(files)),
         radiant_win = tolower(trimws(radiant_win)) %in% c("true", "1"),
         duration_min = duration / 60, medal_id = avg_rank_tier %/% 10L,
         medal_group = factor(medal_groups[pmin(medal_id, 7L)], levels = medal_groups),
         duration_band = cut(duration_min, c(20, 30, 40, Inf), duration_bands, right = FALSE),
         rank_band = cut(medal_id, c(0, 3, 6, 8), rank_bands))
if (anyDuplicated(matches$match_id)) stop("The samples have overlapping match IDs.")
# Large cleaned snapshots are optional and kept outside tracked results.
if (Sys.getenv("DOTA_SAVE_CLEANED", "0") == "1") {
  dir.create("data/processed", recursive = TRUE, showWarnings = FALSE)
  for (patch_name in names(samples)) {
    write_csv(samples[[patch_name]]$data,
              file.path("data", "processed", paste0(patch_name, "_ranked.csv")))
  }
}
