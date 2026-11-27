# Collect ranked Dota 2 matches from OpenDota Explorer.
# Install once, if needed: install.packages(c("httr", "jsonlite"))
#
# By default this collects recent matches, not a fixed historical patch.
# To reuse a saved CSV without making API requests, set OPENDOTA_INPUT_CSV.
# Never commit OPENDOTA_API_KEY or a file containing credentials.

# 1. Settings ----------------------------------------------------------

target_n <- as.integer(Sys.getenv("OPENDOTA_TARGET_N", "100000"))
if (is.na(target_n) || target_n <= 0L) {
  stop("OPENDOTA_TARGET_N must be a positive integer.")
}
page_size <- as.integer(Sys.getenv("OPENDOTA_PAGE_SIZE", "1000"))
if (is.na(page_size) || page_size <= 0L) stop("OPENDOTA_PAGE_SIZE must be positive.")
min_duration_seconds <- 20L * 60L
output_prefix <- paste0("opendota_ranked_", target_n)
output_dir <- Sys.getenv("OPENDOTA_OUTPUT_DIR", file.path("data", "downloads", output_prefix))
input_csv <- Sys.getenv("OPENDOTA_INPUT_CSV", "")

# Preserve the rank selection used by the original analysis.
medal_names <- c(
  "Herald", "Guardian", "Crusader", "Archon",
  "Legend", "Ancient", "Divine", "Immortal"
)
medal_groups <- c(medal_names[1:6], "Divine / Immortal")
rank_codes <- c(11:15, 21:25, 31:35, 41:45, 51:55, 61:65, 71:75)
valid_rank_codes <- c(rank_codes, 80L)

duration_bands <- c("20 to <30", "30 to <40", "40+")
rank_bands <- c("Herald to Crusader", "Archon to Ancient", "Divine / Immortal")

match_columns <- c(
  "match_id", "start_time", "duration", "lobby_type",
  "game_mode", "radiant_win", "avg_rank_tier", "num_rank_tier"
)

# 2. Download eligible matches -----------------------------------------

fetch_page <- function(limit, before_id = NULL) {
  sql <- paste(
    "SELECT", paste(match_columns, collapse = ", "),
    "FROM public_matches",
    "WHERE lobby_type = 7",
    "AND duration >=", min_duration_seconds,
    "AND radiant_win IS NOT NULL",
    "AND avg_rank_tier IN",
    paste0("(", paste(valid_rank_codes, collapse = ","), ")"),
    if (!is.null(before_id)) paste("AND match_id <", before_id),
    "ORDER BY match_id DESC LIMIT", as.integer(limit)
  )

  query <- list(sql = sql)
  api_key <- Sys.getenv("OPENDOTA_API_KEY")
  if (nzchar(api_key)) query$api_key <- api_key

  response <- httr::RETRY(
    "GET", "https://api.opendota.com/api/explorer",
    httr::timeout(40),
    query = query,
    times = 4L,
    pause_min = 2,
    pause_cap = 30,
    terminate_on = c(400L, 401L, 403L, 404L),
    quiet = TRUE
  )

  httr::stop_for_status(response, "download OpenDota public ranked matches")

  result <- jsonlite::fromJSON(
    httr::content(response, as = "text", encoding = "UTF-8"),
    bigint_as_char = TRUE
  )

  if (!is.null(result$err)) stop("The OpenDota Explorer query failed.")
  result$rows
}

download_matches <- function() {
  pages <- list()
  remaining <- target_n
  before_id <- NULL

  while (remaining > 0L) {
    page <- fetch_page(min(remaining, page_size), before_id)
    if (NROW(page) == 0L) break

    if (!is.data.frame(page) || !all(match_columns %in% names(page))) {
      stop("OpenDota returned an unexpected table.")
    }

    ids <- as.numeric(page$match_id)
    if (any(!is.finite(ids)) || anyDuplicated(ids) ||
        (!is.null(before_id) && any(ids >= as.numeric(before_id)))) {
      stop("OpenDota returned invalid or overlapping match IDs.")
    }

    pages[[length(pages) + 1L]] <- page
    remaining <- remaining - nrow(page)
    before_id <- sprintf("%.0f", min(ids))

    message(sprintf("Collected %s / %s matches.",
                    format(target_n - remaining, big.mark = ","),
                    format(target_n, big.mark = ",")))
    if (remaining > 0L) Sys.sleep(1)
  }

  if (length(pages) == 0L) stop("OpenDota returned no eligible matches.")
  do.call(rbind, pages)
}

# 3. Load an existing snapshot or collect a new one ---------------------

raw_matches <- if (nzchar(input_csv)) {
  read.csv(input_csv, colClasses = c(match_id = "character"))
} else {
  message(sprintf("Downloading %s eligible ranked matches.",
                  format(target_n, big.mark = ",")))
  download_matches()
}

if (!all(match_columns %in% names(raw_matches))) {
  stop("The input data are missing one or more expected match columns.")
}

# 4. Save new downloads; leave historical CSV files untouched -----------

if (!nzchar(input_csv)) {
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
  timestamp <- format(Sys.time(), "%Y%m%dT%H%M%SZ", tz = "UTC")
  output_csv <- file.path(output_dir, paste0("raw_matches_", timestamp, ".csv"))
  if (file.exists(output_csv)) stop("Output CSV already exists.")
  write.csv(raw_matches, output_csv, row.names = FALSE)
  message("Saved ", nrow(raw_matches), " matches to ", output_csv)
  if (nrow(raw_matches) < target_n) {
    warning("Downloaded fewer matches than requested.")
  }
}

# The resulting raw_matches data frame is available for subsequent analysis.
