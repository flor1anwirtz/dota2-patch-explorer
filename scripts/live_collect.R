# Aggregate every decided ranked row available in OpenDota Explorer.
# From the repository root: Rscript scripts/live_collect.R YYYY-MM-DD
# Source this file to reuse live_patch_timeline() and live_collect_day().
live_get_json <- function(url, query = list(), explorer = FALSE) {
  for (attempt in 1:3) {
    res <- tryCatch(httr::GET(url, query = query, httr::timeout(55)), error = function(e) NULL)
    code <- if (is.null(res)) 0L else httr::status_code(res)
    body <- if (is.null(res)) "" else httr::content(res, as = "text", encoding = "UTF-8")
    if (explorer && (code %in% c(408L, 504L) ||
                     (code %in% c(200L, 400L, 500L) &&
                      grepl("statement timeout|canceling statement|query timed out|query read timeout",
                            body, ignore.case = TRUE)))) {
      stop(errorCondition("Explorer query timed out.", class = "live_query_timeout"))
    }
    if (code == 200L) {
      result <- jsonlite::fromJSON(body)
      if (explorer && !is.null(result$err)) stop("OpenDota Explorer returned a query error.")
      return(result)
    }
    if (attempt == 3L || !(code %in% c(0L, 408L, 429L) || code >= 500L)) {
      stop("Data request failed (", if (code == 0L) "connection error" else paste("HTTP", code), ").")
    }
    delay <- 2^attempt
    if (!is.null(res)) {
      retry <- httr::headers(res)[["retry-after"]]
      if (!is.null(retry)) {
        seconds <- suppressWarnings(as.numeric(retry))
        if (!is.finite(seconds)) {
          when <- suppressWarnings(as.POSIXct(retry, format = "%a, %d %b %Y %H:%M:%S", tz = "GMT"))
          if (!is.na(when)) seconds <- as.numeric(difftime(when, Sys.time(), units = "secs"))
        }
        if (is.finite(seconds)) delay <- max(delay, seconds)
      }
    }
    if (delay > 90) stop("The upstream requested a longer retry delay. Retry this range later.")
    Sys.sleep(ceiling(delay))
  }
}

live_opendota_query <- function(query = list()) {
  key <- Sys.getenv("OPENDOTA_API_KEY")
  if (nzchar(key)) query$api_key <- key
  query
}

live_patch_timeline <- function() {
  patches <- live_get_json("https://api.opendota.com/api/constants/patch", live_opendota_query())
  valve <- live_get_json("https://www.dota2.com/datafeed/patchnoteslist",
                         list(language = "english"))$patches
  if (!all(c("name", "date") %in% names(patches)) ||
      !all(c("patch_number", "patch_timestamp") %in% names(valve))) {
    stop("Unrecognized patch metadata.")
  }
  # Match start times have one-second precision. The first integer at/after
  # the release is the first possible start under the new patch.
  major <- grepl("^[0-9]+[.][0-9]+$", patches$name)
  exact <- as.POSIXct(patches$date[major], format = "%Y-%m-%dT%H:%M:%OS", tz = "UTC")
  timeline <- data.frame(name = patches$name[major], time = ceiling(as.numeric(exact)))
  if (anyNA(timeline) || anyDuplicated(timeline$name) || anyDuplicated(timeline$time) ||
      !("7.40" %in% timeline$name)) stop("Invalid OpenDota major patch timeline.")
  since <- timeline$time[timeline$name == "7.40"]
  timeline <- timeline[timeline$time >= since, ]
  timeline <- timeline[order(timeline$time), , drop = FALSE]
  official <- valve[grepl("^[0-9]+[.][0-9]+$", valve$patch_number), ]
  dates <- official$patch_timestamp[match(timeline$name, official$patch_number)]
  if (anyNA(dates) || any(abs(timeline$time - dates) > 2 * 86400)) {
    stop("Valve and OpenDota disagree on a release date. Check patch metadata before continuing.")
  }
  newer <- official$patch_timestamp >= dates[1L] & !(official$patch_number %in% timeline$name)
  if (anyNA(newer)) stop("Unrecognized Valve patch timestamp.")
  # Do not mislabel games from an announced release whose precise boundary
  # OpenDota has not supplied. Earlier historical windows can still be saved.
  attr(timeline, "unconfirmed_since") <- if (any(newer)) min(official$patch_timestamp[newer]) else Inf
  # Explorer's public_matches table has rolling retention. An indexed lookup
  # prevents a partly expired day from being archived as a complete day.
  retained <- live_get_json("https://api.opendota.com/api/explorer", live_opendota_query(list(
    sql = "SELECT start_time FROM public_matches WHERE start_time IS NOT NULL ORDER BY start_time LIMIT 1"
  )), explorer = TRUE)
  floor_time <- as.numeric(retained$rows$start_time)
  if (length(floor_time) != 1L || !is.finite(floor_time) || floor_time <= 0) {
    stop("Could not establish the beginning of the retained Explorer data.")
  }
  attr(timeline, "available_since") <- floor_time
  rownames(timeline) <- NULL
  timeline
}

live_range_counts <- function(start, end) {
  query <- paste(
    "SELECT CASE WHEN duration IS NULL OR duration < 0 THEN 'unknown'",
    "WHEN duration < 1200 THEN 'short' WHEN duration < 1800 THEN '20-30'",
    "WHEN duration < 2400 THEN '30-40' ELSE '40+' END AS duration_band,",
    "CASE WHEN avg_rank_tier IN (11,12,13,14,15,21,22,23,24,25,31,32,33,34,35) THEN 'low'",
    "WHEN avg_rank_tier IN (41,42,43,44,45,51,52,53,54,55,61,62,63,64,65) THEN 'mid'",
    "WHEN avg_rank_tier IN (71,72,73,74,75,80) THEN 'high' ELSE 'unknown' END AS rank_band,",
    "COUNT(*) AS n, COUNT(*) FILTER (WHERE radiant_win) AS wins",
    "FROM public_matches WHERE start_time >=", sprintf("%.0f", start),
    "AND start_time <", sprintf("%.0f", end),
    "AND lobby_type = 7 AND radiant_win IS NOT NULL GROUP BY 1,2"
  )
  result <- tryCatch(
    live_get_json("https://api.opendota.com/api/explorer", live_opendota_query(list(sql = query)),
                  explorer = TRUE),
    live_query_timeout = function(e) NULL
  )
  if (is.null(result)) {
    if (end - start <= 3600) stop("Explorer timed out on a one-hour or smaller window.")
    midpoint <- floor((start + end) / 2)
    left <- live_range_counts(start, midpoint)
    right <- live_range_counts(midpoint, end)
    combined <- rbind(left, right)
    if (!nrow(combined)) return(combined)
    return(aggregate(cbind(n, wins) ~ duration_band + rank_band, combined, sum))
  }
  if (is.null(result$rows) || length(result$rowCount) != 1L ||
      !isTRUE(result$rowCount == NROW(result$rows))) stop("Unexpected Explorer result.")
  if (result$rowCount == 0L) {
    return(data.frame(duration_band = character(), rank_band = character(),
                      n = numeric(), wins = numeric()))
  }
  rows <- result$rows
  if (!is.data.frame(rows) || !identical(names(rows), c("duration_band", "rank_band", "n", "wins")) ||
      !all(rows$duration_band %in% c("short", "20-30", "30-40", "40+", "unknown")) ||
      !all(rows$rank_band %in% c("low", "mid", "high", "unknown")) ||
      anyDuplicated(rows[c("duration_band", "rank_band")])) stop("Unexpected aggregate cells.")
  rows$n <- as.numeric(rows$n)
  rows$wins <- as.numeric(rows$wins)
  if (any(!is.finite(rows$n) | !is.finite(rows$wins) | rows$n <= 0 |
          rows$n != floor(rows$n) | rows$wins < 0 | rows$wins > rows$n |
          rows$wins != floor(rows$wins))) stop("Invalid aggregate counts in Explorer response.")
  rows
}

live_collect_day <- function(day, timeline, dir = "data/live") {
  label <- as.character(day)
  if (length(label) != 1L || !grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}$", label)) {
    stop("Supply one ISO UTC date.")
  }
  day <- as.Date(label, "%Y-%m-%d")
  if (is.na(day) || format(day) != label || day >= as.Date(Sys.time(), tz = "UTC")) {
    stop("Supply a completed UTC day.")
  }
  start <- max(as.numeric(day) * 86400, timeline$time[1L])
  end <- (as.numeric(day) + 1) * 86400
  if (end <= start) stop("This day ends before patch 7.40.")
  retained <- attr(timeline, "available_since", exact = TRUE)
  if (!is.null(retained) && start < retained) stop("This UTC window precedes full Explorer retention.")
  pending <- attr(timeline, "unconfirmed_since", exact = TRUE)
  if (!is.null(pending) && end > pending) stop("Waiting for a confirmed OpenDota patch boundary.")
  cuts <- c(start, timeline$time[timeline$time > start & timeline$time < end], end)
  pieces <- vector("list", length(cuts) - 1L)
  for (i in seq_along(pieces)) {
    rows <- live_range_counts(cuts[i], cuts[i + 1L])
    if (!nrow(rows) && cuts[i + 1L] - cuts[i] >= 3600) {
      stop("No decided ranked matches found for the requested patch window on ", label, ".")
    }
    rows$patch <- rep(timeline$name[findInterval(cuts[i], timeline$time)], nrow(rows))
    pieces[[i]] <- rows
  }
  out <- do.call(rbind, pieces)
  if (!nrow(out)) stop("No ranked matches for ", label, ". No day file written.")
  out <- out[order(out$patch, out$duration_band, out$rank_band),
             c("patch", "duration_band", "rank_band", "n", "wins")]
  dir.create(dir, showWarnings = FALSE, recursive = TRUE)
  stage <- tempfile(".live-", tmpdir = dir)
  on.exit(unlink(stage))
  # CSV carries plain integer counts regardless of R's scientific-notation preference.
  serialized <- out
  serialized$n <- sprintf("%.0f", out$n)
  serialized$wins <- sprintf("%.0f", out$wins)
  write.csv(serialized, stage, row.names = FALSE, quote = FALSE)
  file <- file.path(dir, paste0(label, ".csv"))
  if (!file.rename(stage, file)) stop("Could not install the acquired day.")
  message(label, ": ", sum(out$n), " ranked matches")
  invisible(out)
}

if (sys.nframe() == 0L) {
  args <- commandArgs(trailingOnly = TRUE)
  if (length(args) != 1L) stop("Usage: Rscript scripts/live_collect.R YYYY-MM-DD")
  live_collect_day(args[1L], live_patch_timeline())
}
