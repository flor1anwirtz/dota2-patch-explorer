# Offline regression checks: Rscript tests/verify_day.R
source("scripts/verify_day.R")

run_tests <- function() {
  tmp <- tempfile("check-day-")
  dir.create(tmp)
  on.exit(unlink(tmp, recursive = TRUE))
  times <- data.frame(name = c("7.40","7.41"), time = c(1765846241, 1774313460))
  bounds <- file.path(tmp, "patches.csv")
  write.csv(times, bounds, row.names = FALSE)
  day <- "2026-03-24"
  testfile <- file.path(tmp, paste0(day, ".csv"))
  sample <- data.frame(patch = c("7.40", "7.41"), duration_band = "short",
                       rank_band = "low", n = c(2, 3), wins = c(1, 2))
  write.csv(sample, testfile, row.names = FALSE)
  original <- readBin(testfile, "raw", n = file.info(testfile)$size)
  windows <- verification_windows(day, times)
  stopifnot(nrow(windows) == 2L, windows$end[1L] == windows$start[2L],
            windows$end[1L] == 1774313460, windows$end[2L]-windows$start[1L] == 86400)
  never <- function(...) stop("Unexpected HTTP request")
  output <- capture.output(verify_day(day, "sql", bounds, tmp, never))
  stopifnot(any(grepl("1774313460", output)), any(grepl("COALESCE", output)))
  capture.output(verify_day(day, "offline", bounds, tmp, never))
  floor_time <- 1700000000
  sum_wins <- 3
  mismatched <- FALSE
  fake <- function(sql) {
    if (grepl("ORDER BY start_time", sql)) return(data.frame(start_time = floor_time))
    if (!grepl("GROUP BY", sql)) return(data.frame(n = "5", wins = as.character(sum_wins)))
    later <- grepl("start_time >= 1774313460", sql)
    data.frame(duration_band = "short", rank_band = if (mismatched && later) "unknown" else "low",
               radiant_win = c(FALSE, TRUE), n = c(1, if (later) 2 else 1))
  }
  capture.output(verify_day(day, "online", bounds, tmp, fake))
  fails <- function(expr, pattern) {
    result <- tryCatch({capture.output(force(expr)); ""}, error = conditionMessage)
    stopifnot(grepl(pattern, result, fixed = TRUE))
  }
  patch_fetch <- function(sql) {
    stopifnot(!grepl("GROUP BY", sql), grepl("COALESCE", sql))
    later <- grepl("start_time >= 1774313460", sql)
    data.frame(n = if (later) 3 else 2, wins = if (later) 2 else 1)
  }
  stopifnot(verify_source_totals(day, times, sample, patch_fetch))
  transferred <- sample
  transferred$wins <- rev(transferred$wins)
  stopifnot(identical(colSums(sample[c("n","wins")]), colSums(transferred[c("n","wins")])))
  fails(verify_source_totals(day, times, transferred, patch_fetch), "Independent totals differ")
  fails(verify_source_totals(day, times, sample, function(sql) stop("source unavailable")),
        "source unavailable")
  mismatched <- TRUE
  fails(verify_day(day, "online", bounds, tmp, fake), "DIFFERENT:")
  mismatched <- FALSE
  sum_wins <- 4
  fails(verify_day(day, "online", bounds, tmp, fake), "the upstream grouped and independent totals differ")
  floor_time <- 1790000000
  fails(verify_day(day, "online", bounds, tmp, fake), "earliest retained")
  fails(verify_day("2026-03-23", "offline", bounds, tmp, never), "MISSING ARCHIVE:")
  stopifnot(identical(readBin(testfile, "raw", n = file.info(testfile)$size), original))
  cat("Verification CLI checks passed.\n")
}
run_tests()
