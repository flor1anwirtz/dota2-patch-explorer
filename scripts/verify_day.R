# Run from the repository root. This read-only command never writes an archive.
# Rscript scripts/verify_day.R YYYY-MM-DD [--sql|--offline]
source("scripts/live_export.R")
source("scripts/live_collect.R")

verification_windows <- function(day, timeline) {
  midnight <- as.numeric(live_utc_date(day)) * 86400
  finish <- midnight + 86400
  next_patch <- c(timeline$time[-1L], Inf)
  active <- which(timeline$time < finish & next_patch > midnight)
  if (!length(active)) stop("This day precedes patch 7.40.")
  data.frame(patch = timeline$name[active], start = pmax(midnight, timeline$time[active]),
             end = pmin(finish, next_patch[active]))
}

verification_query <- function(start, end, grouped) {
  # Use a separate query from the collector. Group by winner and have R count
  # the wins; an independently queried ungrouped total checks the whole day.
  window <- sprintf(
    "FROM public_matches\nWHERE lobby_type = 7 AND radiant_win IS NOT NULL\n  AND start_time >= %.0f AND start_time < %.0f",
    start, end)
  if (!grouped) return(paste("SELECT COUNT(*) AS n,",
    "COALESCE(SUM(CASE WHEN radiant_win THEN 1 ELSE 0 END), 0) AS wins", window, sep = "\n"))
  ranks <- function(medals) paste(as.vector(outer(1:5, 10L * medals, "+")), collapse = ",")
  paste("SELECT CASE",
        "  WHEN duration BETWEEN 0 AND 1199 THEN 'short'",
        "  WHEN duration BETWEEN 1200 AND 1799 THEN '20-30'",
        "  WHEN duration BETWEEN 1800 AND 2399 THEN '30-40'",
        "  WHEN duration >= 2400 THEN '40+' ELSE 'unknown' END AS duration_band,",
        "  CASE",
        paste0("  WHEN avg_rank_tier IN (", ranks(1:3), ") THEN 'low'"),
        paste0("  WHEN avg_rank_tier IN (", ranks(4:6), ") THEN 'mid'"),
        paste0("  WHEN avg_rank_tier IN (", ranks(7L), ",80) THEN 'high'"),
        "  ELSE 'unknown' END AS rank_band,",
        "  radiant_win, COUNT(*) AS n", window, "GROUP BY 1, 2, 3", sep = "\n")
}

verification_rows <- function(query) {
  resp <- live_get_json("https://api.opendota.com/api/explorer",
                        live_opendota_query(list(sql = query)), explorer = TRUE)
  if (is.null(resp$rows) || length(resp$rowCount) != 1L ||
      !isTRUE(resp$rowCount == NROW(resp$rows))) stop("UNVERIFIED: malformed Explorer response.")
  resp$rows
}

verification_counts <- function(start, end, grouped, fetch = verification_rows) {
  rows <- tryCatch(fetch(verification_query(start, end, grouped)),
                   live_query_timeout = function(e) NULL)
  if (is.null(rows)) {
    if (end - start <= 3600) stop("UNVERIFIED: Explorer timed out on a window of one hour or less.")
    mid <- floor((start + end) / 2)
    left <- verification_counts(start, mid, grouped, fetch)
    right <- verification_counts(mid, end, grouped, fetch)
    if (!grouped) return(left + right)
    counts <- rbind(left, right)
    if (!nrow(counts)) return(counts)
    return(aggregate(cbind(n, wins) ~ duration_band + rank_band, counts, sum))
  }
  as_count <- function(x) {
    value <- suppressWarnings(as.numeric(x))
    if (anyNA(value) || any(!is.finite(value) | value < 0 | value != floor(value))) {
      stop("UNVERIFIED: invalid counts returned by Explorer.")
    }
    value
  }
  if (!grouped) {
    if (!identical(names(rows), c("n","wins")) || nrow(rows) != 1L) {
      stop("UNVERIFIED: invalid ungrouped Explorer result.")
    }
    result <- c(n = as_count(rows$n), wins = as_count(rows$wins))
    if (result["wins"] > result["n"]) stop("UNVERIFIED: invalid independent win total.")
    return(result)
  }
  if (!NROW(rows)) return(data.frame(duration_band = character(), rank_band = character(),
                                      n = numeric(), wins = numeric()))
  dims <- live_dimensions()
  if (!identical(names(rows), c("duration_band","rank_band","radiant_win","n")) ||
      !all(rows$duration_band %in% dims$duration) || !all(rows$rank_band %in% dims$rank) ||
      !is.logical(rows$radiant_win) || anyNA(rows$radiant_win) ||
      anyDuplicated(rows[c("duration_band","rank_band","radiant_win")])) {
    stop("UNVERIFIED: unexpected grouped rows returned by Explorer.")
  }
  rows$n <- as_count(rows$n)
  rows$wins <- ifelse(rows$radiant_win, rows$n, 0)
  aggregate(cbind(n, wins) ~ duration_band + rank_band, rows, sum)
}

verification_differences <- function(archive, upstream) {
  keys <- c("patch","duration_band","rank_band")
  x <- merge(archive, upstream, by = keys, all = TRUE, suffixes = c("_archive","_source"))
  for (name in setdiff(names(x), keys)) x[[name]][is.na(x[[name]])] <- 0
  x[x$n_archive != x$n_source | x$wins_archive != x$wins_source, , drop = FALSE]
}

verify_source_totals <- function(day, timeline, archive, fetch = verification_rows) {
  windows <- verification_windows(day, timeline)
  for (i in seq_len(nrow(windows))) {
    label <- windows$patch[i]
    saved <- colSums(archive[archive$patch == label, c("n","wins"), drop = FALSE])
    actual <- verification_counts(windows$start[i], windows$end[i], FALSE, fetch)
    if (!all(saved == actual)) {
      stop(sprintf(paste0("Independent totals differ for %s UTC patch %s: ",
                          "collection %.0f matches / %.0f Radiant wins; ",
                          "verification %.0f matches / %.0f Radiant wins. Retry before accepting this date."),
                   day, label, saved["n"], saved["wins"], actual["n"], actual["wins"]))
    }
  }
  invisible(TRUE)
}

verify_day <- function(date, mode = "online", timeline_file = "data/live-patches.csv",
                       directory = "data/live", fetch = verification_rows) {
  day <- live_utc_date(date)
  if (day >= as.Date(Sys.time(), tz = "UTC")) stop("Supply a completed UTC day.")
  if (!file.exists(timeline_file)) stop("Missing saved patch boundaries: ", timeline_file)
  timeline <- live_check_timeline(read.csv(timeline_file, colClasses = "character"))
  windows <- verification_windows(day, timeline)
  start <- min(windows$start)
  end <- max(windows$end)
  if (mode == "sql") {
    cat("-- UTC day ", format(day), ". End times are exclusive.\n", sep = "")
    for (i in seq_len(nrow(windows))) {
      cat("\n-- Grouped verification for patch ", windows$patch[i], "\n",
          verification_query(windows$start[i], windows$end[i], TRUE), ";\n", sep = "")
    }
    cat("\n-- Independent whole-day totals\n", verification_query(start, end, FALSE), ";\n", sep = "")
    return(invisible(TRUE))
  }
  file <- file.path(directory, paste0(format(day), ".csv"))
  if (!file.exists(file)) stop("MISSING ARCHIVE: ", file, ". This date is not verified.")
  archive <- live_read_counts(file, windows$patch)
  tallies <- colSums(archive[c("n","wins")])
  cat(sprintf("Archive %s UTC: %.0f matches, %.0f Radiant wins, %.0f Dire wins.\n",
              format(day), tallies["n"], tallies["wins"], tallies["n"] - tallies["wins"]))
  print(windows, row.names = FALSE, digits = 12)
  if (mode == "offline") {
    cat("OFFLINE: local schema, unique group keys and counts passed. No upstream comparison.\n")
    return(invisible(TRUE))
  }
  floor_row <- fetch("SELECT start_time FROM public_matches WHERE start_time IS NOT NULL ORDER BY start_time LIMIT 1")
  first <- suppressWarnings(as.numeric(floor_row$start_time))
  if (length(first) != 1L || !is.finite(first)) stop("UNVERIFIED: upstream retention is unknown.")
  if (start < first) stop("UNVERIFIED: the archived UTC window extends before the earliest retained ",
                          "OpenDota record. Use the archived CSV for this date.")
  parts <- lapply(seq_len(nrow(windows)), function(i) {
    x <- verification_counts(windows$start[i], windows$end[i], TRUE, fetch)
    x$patch <- rep(windows$patch[i], nrow(x))
    x
  })
  rows <- do.call(rbind, parts)
  independent <- verification_counts(start, end, FALSE, fetch)
  grouped <- colSums(rows[c("n","wins")])
  cat(sprintf("OpenDota %s UTC: %.0f matches, %.0f Radiant wins (independent whole-day query).\n",
              format(day), independent["n"], independent["wins"]))
  if (!all(grouped == independent)) {
    stop("UNVERIFIED: the upstream grouped and independent totals differ. Records may have changed between queries. Retry.")
  }
  mismatch <- verification_differences(archive, rows)
  if (nrow(mismatch) || !all(tallies == independent)) {
    if (nrow(mismatch)) print(mismatch, row.names = FALSE)
    stop("DIFFERENT: the archive and current OpenDota records differ. Late indexing and source corrections ",
         "can change counts. The archive was not modified.")
  }
  cat(sprintf("MATCH: all patch, duration and rank counts, both win totals and the independent day total agree.\n"))
  invisible(TRUE)
}

if (sys.nframe() == 0L) {
  args <- commandArgs(trailingOnly = TRUE)
  flags <- startsWith(args, "--")
  if (sum(!flags) != 1L || sum(flags) > 1L || any(!args[flags] %in% c("--sql","--offline"))) {
    stop("Usage: Rscript scripts/verify_day.R YYYY-MM-DD [--sql|--offline]")
  }
  mode <- if (any(flags)) substring(args[flags], 3L) else "online"
  tryCatch(verify_day(args[!flags], mode),
           error = function(e) { message(conditionMessage(e)); quit(status = 1L) })
}
