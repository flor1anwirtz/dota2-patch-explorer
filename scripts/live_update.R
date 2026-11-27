# Run from the repository root: Rscript scripts/live_update.R
# DOTA_BACKFILL_DAYS controls the maximum number of additional missing days per run.
source("scripts/live_collect.R")
source("scripts/live_export.R")

# A corrected release timestamp can change day groups without changing either date.
# Compare all effective intervals on archived days whenever the timeline changes.
live_day_intervals <- function(day, timeline) {
  start <- as.numeric(live_utc_date(day)) * 86400
  end <- start + 86400
  indexes <- which(timeline$time < end & c(timeline$time[-1L], Inf) > start)
  paste(timeline$name[indexes], pmax(start, timeline$time[indexes]), collapse = "|")
}

live_update <- function() {
  budget <- Sys.getenv("DOTA_BACKFILL_DAYS", "8")
  if (!grepl("^[0-9]{1,3}$", budget) || as.integer(budget) > 366L) {
    stop("DOTA_BACKFILL_DAYS must be an integer between 0 and 366.")
  }
  archive <- "data/live"
  snapshot <- "data/live-patches.csv"
  dir.create(archive, recursive = TRUE, showWarnings = FALSE)
  timeline <- live_patch_timeline()
  boundaries <- live_check_timeline(timeline)
  first <- as.Date(floor(boundaries$time[1L] / 86400), origin = "1970-01-01")
  yesterday <- as.Date(Sys.time(), tz = "UTC") - 1L
  through <- yesterday
  pending <- attr(timeline, "unconfirmed_since", exact = TRUE)
  if (!is.null(pending) && is.finite(pending)) {
    through <- min(through, as.Date(floor(pending / 86400), origin = "1970-01-01") - 1L)
    if (through < yesterday) message("Latest confirmed complete UTC day is ", through, ".")
  }
  if (through < first) stop("No confirmed completed UTC dates to collect.")
  days <- format(seq(first, through, by = "day"))
  saved <- live_archive_days(archive)
  revised <- character()
  if (file.exists(snapshot) && length(saved)) {
    previous <- live_check_timeline(read.csv(snapshot, colClasses = "character"))
    if (!identical(previous, boundaries)) {
      revised <- saved[vapply(saved, function(day) {
        live_day_intervals(day, previous) != live_day_intervals(day, boundaries)
      }, logical(1))]
    }
  }
  if (any(saved > format(through))) {
    stop("The patch sources are still confirming a date already archived. Check the release boundaries.")
  }
  refresh <- rev(tail(days, 3L))
  available <- attr(timeline, "available_since", exact = TRUE)
  retrievable <- days
  if (!is.null(available) && is.finite(available)) {
    starts <- pmax(as.numeric(as.Date(days)) * 86400, boundaries$time[1L])
    retrievable <- days[starts >= available]
  }
  backlog <- head(setdiff(retrievable, c(saved, refresh)), as.integer(budget))
  planned <- unique(c(refresh, revised, backlog))
  work <- tempfile("daily-update-", tmpdir = archive)
  if (!dir.create(work)) stop("Could not create an update staging directory.")
  on.exit(unlink(work, recursive = TRUE))
  succeeded <- failed <- character()
  for (day in planned) {
    done <- tryCatch({
      live_collect_day(day, timeline, dir = work)
      live_read_counts(file.path(work, paste0(day, ".csv")), live_day_labels(day, boundaries))
      TRUE
    }, error = function(err) {
      message("Could not update ", day, ": ", conditionMessage(err))
      FALSE
    })
    if (done) succeeded <- c(succeeded, day) else failed <- c(failed, day)
  }
  if (!length(succeeded)) stop("No daily collection succeeded. Keeping the previous dashboard.")
  if (length(setdiff(revised, succeeded))) {
    stop("Corrected release boundaries need a successful recount before publishing.")
  }
  for (day in succeeded) {
    file <- paste0(day, ".csv")
    if (!file.rename(file.path(work, file), file.path(archive, file))) {
      stop("Could not checkpoint ", day)
    }
  }
  live_export(boundaries, through = through, dir = archive)
  write.csv(transform(boundaries, time = sprintf("%.0f", boundaries$time)),
            file.path(work, "timeline.csv"), row.names = FALSE, quote = FALSE)
  if (!file.rename(file.path(work, "timeline.csv"), snapshot)) stop("Could not save patch boundaries.")
  missing <- setdiff(days, live_archive_days(archive))
  message(length(succeeded), " day(s) collected; ", length(missing), " still missing through ", through, ".")
  if (length(failed)) message("Days to retry: ", paste(failed, collapse = ", "))
  summary_file <- Sys.getenv("GITHUB_STEP_SUMMARY")
  if (nzchar(summary_file)) {
    lines <- c("## Ranked match update", "",
      paste("UTC dates successfully collected or refreshed:", paste(succeeded, collapse = ", ")),
      paste("Missing UTC dates through", through, ":", length(missing)))
    if (length(failed)) lines <- c(lines, paste("Upstream dates to retry:", paste(failed, collapse = ", ")))
    cat(paste0(lines, collapse = "\n\n"), "\n", file = summary_file, append = TRUE)
  }
  invisible(list(succeeded = succeeded, failed = failed, missing = missing))
}

if (sys.nframe() == 0L) live_update()
