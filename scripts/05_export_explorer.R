# Export match counts for the static Patch Explorer from local CSV snapshots.
# From the repository root:
#   Rscript scripts/05_export_explorer.R
# Or supply files in display order (two or more), with an optional output path:
#   Rscript scripts/05_export_explorer.R --output=docs/data.js 7.41=data/raw/7.41dota2.csv 7.42=data/raw/7.42dota2.csv
# Requirements: R >= 4.1, jsonlite. The export performs no network requests.
if (!requireNamespace("jsonlite", quietly = TRUE)) stop("Install the R package jsonlite.")
args <- commandArgs(trailingOnly = TRUE)
output_args <- startsWith(args, "--output=")
if (sum(output_args) > 1L) stop("Specify --output once.")
destination <- if (any(output_args)) sub("^--output=", "", args[output_args]) else "docs/data.js"
args <- args[!output_args]
if (!length(args)) {
  files <- c("7.41" = Sys.getenv("DOTA_PATCH_741_CSV", "data/raw/7.41dota2.csv"),
             "7.42" = Sys.getenv("DOTA_PATCH_742_CSV", "data/raw/7.42dota2.csv"))
} else {
  if (any(!grepl("^[^=]+=.+$", args))) {
    stop("Supply each patch as PATCH=path/to/file.csv.")
  }
  files <- setNames(sub("^[^=]+=", "", args), sub("=.*$", "", args))
}
if (length(files) < 2L || anyDuplicated(names(files))) stop("Supply at least two distinct patch labels.")
if (!all(file.exists(files))) stop("Missing input: ", paste(files[!file.exists(files)], collapse = ", "))
if (!nzchar(destination)) stop("The output path is empty.")

# These codes and filters match scripts/02_clean_data.R.
rank_codes <- as.vector(outer(1:5, 10 * (1:7), "+"))
medals <- c("Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine")
duration_keys <- c("20-30", "30-40", "40+")
rank_keys <- c("low", "mid", "high")
required <- c("match_id", "start_time", "duration", "lobby_type", "game_mode",
              "radiant_win", "avg_rank_tier", "num_rank_tier")
as_utc <- function(seconds) {
  format(as.POSIXct(seconds, origin = "1970-01-01", tz = "UTC"), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
}
# An exact two-sided test against 50%, retaining p-values below double range.
format_log_p <- function(log_p) {
  if (log_p >= log(0.001)) return(sprintf("%.4g", exp(log_p)))
  exponent <- floor(log_p / log(10))
  sprintf("%.4fe%d", exp(log_p - exponent * log(10)), as.integer(exponent))
}
rates <- function(n, wins) {
  data.frame(n = as.numeric(n), wins = as.numeric(wins),
             radiantPct = as.numeric(ifelse(n > 0, 100 * wins / n, NA_real_)))
}
build_patch <- function(path, label) {
  raw <- read.csv(path, colClasses = "character", check.names = FALSE,
                  na.strings = c("", "NA", "null"), stringsAsFactors = FALSE)
  if (!all(required %in% names(raw))) stop("Missing columns in ", path, ": ",
                                          paste(setdiff(required, names(raw)), collapse = ", "))
  for (column in c("duration", "lobby_type", "avg_rank_tier", "start_time")) {
    raw[[column]] <- suppressWarnings(as.numeric(raw[[column]]))
  }
  ranked <- raw$lobby_type %in% 7L
  long_enough <- ranked & is.finite(raw$duration) & raw$duration >= 1200L
  outcome <- tolower(trimws(raw$radiant_win))
  eligible <- long_enough & raw$avg_rank_tier %in% c(rank_codes, 80L) &
    grepl("^[1-9][0-9]*$", raw$match_id) & outcome %in% c("true", "false", "1", "0")
  data <- unique(raw[eligible, , drop = FALSE])
  if (!nrow(data)) stop("No eligible matches in ", path)
  if (anyDuplicated(data$match_id)) stop("Conflicting records for one match ID in ", path)
  if (any(!is.finite(data$start_time))) stop("Missing or invalid start time in ", path)

  won <- tolower(trimws(data$radiant_win)) %in% c("true", "1")
  minutes <- data$duration / 60
  duration <- cut(minutes, c(20, 30, 40, Inf), labels = duration_keys, right = FALSE)
  rank <- cut(data$avg_rank_tier %/% 10, c(0, 3, 6, 8), labels = rank_keys)
  all_counts <- table(duration, rank)
  win_counts <- table(duration[won], rank[won])
  joint <- expand.grid(duration = duration_keys, rank = rank_keys, stringsAsFactors = FALSE)
  mean_code <- rank_codes[floor(mean(match(pmin(data$avg_rank_tier, 75), rank_codes)) + 0.5)]
  patch <- list(
    id = label,
    total = as.list(rates(nrow(data), sum(won))),
    duration = cbind(key = duration_keys, rates(rowSums(all_counts), rowSums(win_counts))),
    rank = cbind(key = rank_keys, rates(colSums(all_counts), colSums(win_counts))),
    joint = cbind(joint, rates(as.vector(all_counts), as.vector(win_counts))),
    metadata = list(csvRows = nrow(raw), rankedRows = sum(ranked), ranked20Rows = sum(long_enough),
                    firstUtc = as_utc(min(data$start_time)), lastUtc = as_utc(max(data$start_time)),
                    meanMinutes = mean(minutes), medianMinutes = median(minutes),
                    minMinutes = min(minutes), maxMinutes = max(minutes), matches80Plus = sum(minutes >= 80),
                    meanMedal = paste(medals[mean_code %/% 10L], mean_code %% 10L),
                    pVsFifty = format_log_p(min(0, log(2) + pbinom(min(sum(won), sum(!won)),
                                                                   nrow(data), 0.5, log.p = TRUE))))
  )
  list(patch = patch, ids = data$match_id)
}

patches <- list()
seen_ids <- character()
for (label in names(files)) {
  result <- build_patch(files[[label]], label)
  if (any(result$ids %in% seen_ids)) stop("Patch ", label, " overlaps a previous patch by match ID.")
  seen_ids <- c(seen_ids, result$ids)
  patches[[length(patches) + 1L]] <- result$patch
  message(label, ": ", result$patch$total$n, " eligible matches")
}
# Compare the first and last supplied snapshots, matching the repository's
# unpooled 95% interval and uncorrected two-proportion test.
ends <- patches[c(1L, length(patches))]
n <- vapply(ends, function(patch) patch$total$n, numeric(1))
wins <- vapply(ends, function(patch) patch$total$wins, numeric(1))
rate <- wins / n
delta <- diff(rate)
radius <- qnorm(0.975) * sqrt(sum(rate * (1 - rate) / n))
pooled <- sum(wins) / sum(n)
variance <- pooled * (1 - pooled) * sum(1 / n)
log_p <- if (variance == 0) 0 else pchisq(delta^2 / variance, 1, lower.tail = FALSE, log.p = TRUE)
comparison <- list(from = ends[[1]]$id, to = ends[[2]]$id, radiantChangePp = 100 * delta,
                   lower95Pp = 100 * (delta - radius), upper95Pp = 100 * (delta + radius),
                   pValue = format_log_p(log_p))
notes <- as.list(setNames(rep("Counts and all nine cross-tabulated cells come from the supplied CSV.", length(files)),
                          names(files)))
notes$patchLabels <- "Historical snapshot labels are provided by the input filenames or command line."
payload <- jsonlite::toJSON(list(patches = patches, comparison = comparison, sourceNotes = notes),
                            dataframe = "rows", auto_unbox = TRUE,
                            digits = NA, na = "null", null = "null", pretty = TRUE)
dir.create(dirname(destination), recursive = TRUE, showWarnings = FALSE)
save_payload <- function() {
  temp <- tempfile(pattern = "explorer-", tmpdir = dirname(destination), fileext = ".js")
  on.exit(unlink(temp))
  writeLines(paste0("window.PATCH_DATA = ", payload, ";"), temp, useBytes = TRUE)
  if (!file.rename(temp, destination)) stop("Could not replace ", destination)
}
save_payload()
message("Wrote ", normalizePath(destination, winslash = "/"))
