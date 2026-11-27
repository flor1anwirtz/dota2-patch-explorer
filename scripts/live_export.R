# Build the live dashboard from immutable daily totals and verified patch boundaries.
# Rscript scripts/live_export.R [--timeline=data/live-patches.csv] [--through=YYYY-MM-DD]
live_utc_date <- function(value) {
  if (inherits(value, "Date") && length(value) == 1L && !is.na(value)) return(value)
  if (length(value) != 1L || is.na(value) || !grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}$", value)) {
    stop("Expected a UTC calendar date (YYYY-MM-DD).")
  }
  day <- as.Date(value, format = "%Y-%m-%d")
  if (is.na(day) || format(day) != value) stop("Invalid UTC calendar date: ", value)
  day
}

live_check_timeline <- function(x) {
  if (!is.data.frame(x) || !all(c("name","time") %in% names(x)) || !nrow(x)) {
    stop("A patch timeline must have name and time columns.")
  }
  x <- data.frame(name = as.character(x$name), time = as.numeric(x$time))
  if (anyNA(x) || !all(grepl("^[0-9]+[.][0-9]+$", x$name)) ||
      anyDuplicated(x$name) || any(!is.finite(x$time) | x$time != ceiling(x$time)) ||
      any(diff(x$time) <= 0) || x$name[1L] != "7.40") stop("Invalid 7.40+ patch timeline.")
  x
}

live_day_labels <- function(day, timeline) {
  start <- as.numeric(live_utc_date(day)) * 86400
  end_times <- c(timeline$time[-1L], Inf)
  timeline$name[timeline$time < start + 86400 & end_times > start]
}

live_dimensions <- function() {
  expand.grid(duration = c("short","20-30","30-40","40+","unknown"),
              rank = c("low","mid","high","unknown"), stringsAsFactors = FALSE)
}

live_read_counts <- function(path, allowed_patches) {
  x <- read.csv(path, colClasses = "character", na.strings = character(), check.names = FALSE)
  fields <- c("patch","duration_band","rank_band","n","wins")
  if (!identical(names(x), fields) || !nrow(x)) stop("Invalid count table: ", path)
  dims <- live_dimensions()
  if (!all(x$patch %in% allowed_patches) ||
      !all(x$duration_band %in% dims$duration & x$rank_band %in% dims$rank) ||
      anyDuplicated(x[c("patch","duration_band","rank_band")]) ||
      !all(grepl("^[0-9]+$", x$n) & grepl("^[0-9]+$", x$wins))) {
    stop("Invalid patch, group or count in ", path)
  }
  x$n <- as.numeric(x$n)
  x$wins <- as.numeric(x$wins)
  if (any(!is.finite(x$n) | !is.finite(x$wins) | x$n > 2^53 - 1 | x$wins > x$n) ||
      sum(x$n) <= 0) stop("Counts do not reconcile in ", path)
  x
}

live_archive_days <- function(dir) {
  if (!dir.exists(dir)) return(character())
  files <- list.files(dir, pattern = "[.]csv$", full.names = FALSE)
  if (any(!grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}[.]csv$", files))) {
    stop("Unexpected CSV filename in ", dir)
  }
  sort(sub("[.]csv$", "", files))
}

live_export <- function(timeline, through = as.Date(Sys.time(), tz = "UTC") - 1L,
                        dir = "data/live", out = "docs/live-data.js", now = Sys.time()) {
  if (!requireNamespace("jsonlite", quietly = TRUE)) stop("Install the R package jsonlite.")
  timeline <- live_check_timeline(timeline)
  through <- live_utc_date(through)
  if (through >= as.Date(now, tz = "UTC")) stop("Only completed UTC days can be published.")
  midnight <- function(seconds) as.Date(floor(seconds / 86400), origin = "1970-01-01")
  first <- midnight(timeline$time)
  last <- c(midnight(timeline$time[-1L] - 1), through)
  last <- pmin(last, through)
  keep <- which(first <= through)
  if (!length(keep)) stop("The reporting date is earlier than patch 7.40.")
  days <- live_archive_days(dir)
  outside <- days < format(first[1L]) | days > format(through)
  if (any(outside)) stop("Archive dates outside the requested timeline: ", paste(days[outside], collapse = ", "))
  dims <- live_dimensions()
  totals <- lapply(keep, function(i) transform(dims, n = 0, wins = 0))
  names(totals) <- timeline$name[keep]
  keys <- paste(dims$duration, dims$rank, sep = "/")
  for (date in days) {
    rows <- live_read_counts(file.path(dir, paste0(date, ".csv")), live_day_labels(date, timeline))
    for (label in unique(rows$patch)) {
      group <- rows[rows$patch == label, ]
      positions <- match(paste(group$duration_band, group$rank_band, sep = "/"), keys)
      totals[[label]]$n[positions] <- totals[[label]]$n[positions] + group$n
      totals[[label]]$wins[positions] <- totals[[label]]$wins[positions] + group$wins
    }
  }
  patches <- lapply(keep, function(i) {
    start <- format(first[i])
    end <- format(last[i])
    covered <- days[days >= start & days <= end]
    expected <- as.integer(last[i] - first[i]) + 1L
    list(id = timeline$name[i], firstDay = start, lastDay = end,
         coveredDays = length(covered), expectedDays = expected,
         latestDay = if (length(covered)) tail(covered, 1L) else NULL,
         complete = length(covered) == expected, cells = totals[[timeline$name[i]]])
  })
  data <- list(asOfUtc = format(now, tz = "UTC", format = "%Y-%m-%dT%H:%M:%SZ"),
               throughDate = format(through), patches = patches)
  json <- jsonlite::toJSON(data, auto_unbox = TRUE, dataframe = "rows", null = "null",
                           digits = NA, pretty = TRUE)
  dir.create(dirname(out), recursive = TRUE, showWarnings = FALSE)
  temp <- tempfile("live-export-", tmpdir = dirname(out))
  on.exit(unlink(temp))
  writeLines(paste0("window.LIVE_DATA = ", json, ";"), temp, useBytes = TRUE)
  if (!file.rename(temp, out)) stop("Could not install ", out)
  invisible(data)
}

if (sys.nframe() == 0L) {
  args <- commandArgs(trailingOnly = TRUE)
  if (any(!grepl("^--(timeline|through)=", args)) || anyDuplicated(sub("=.*", "", args))) {
    stop("Usage: Rscript scripts/live_export.R [--timeline=path.csv] [--through=YYYY-MM-DD]")
  }
  option <- function(name, default) {
    arg <- args[startsWith(args, paste0("--", name, "="))]
    if (length(arg)) sub("^[^=]*=", "", arg) else default
  }
  # Prefer the committed timeline so rebuilds work offline.
  source_file <- option("timeline", if (file.exists("data/live-patches.csv")) "data/live-patches.csv" else "")
  if (nzchar(source_file)) {
    timeline <- read.csv(source_file, colClasses = "character")
  } else {
    source("scripts/live_collect.R")
    timeline <- live_patch_timeline()
  }
  live_export(timeline, through = option("through", format(as.Date(Sys.time(), tz = "UTC") - 1L)))
}
