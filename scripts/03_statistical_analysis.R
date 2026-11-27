# Original descriptive summaries, binomial and two-proportion tests, and stratification.
#sample overview
coverage <- matches |>
  group_by(patch) |>
  summarise(n = n(), radiant_wins = sum(radiant_win), dire_wins = n - radiant_wins,
            radiant_pct = 100 * mean(radiant_win), dire_pct = 100 - radiant_pct,
            first_utc = format(as.POSIXct(min(start_time), origin = "1970-01-01", tz = "UTC"), tz = "UTC"),
            last_utc = format(as.POSIXct(max(start_time), origin = "1970-01-01", tz = "UTC"), tz = "UTC"),
            mean_min = mean(duration_min), median_min = median(duration_min),
            min_min = min(duration_min), max_min = max(duration_min),
            matches_80_plus = sum(duration_min >= 80),
            mean_code = rank_codes[floor(mean(match(pmin(avg_rank_tier, 75), rank_codes)) + 0.5)],
            mean_medal = paste(medal_names[mean_code %/% 10], mean_code %% 10), .groups = "drop") |>
  select(-mean_code) |> left_join(audit, by = "patch") |>
  relocate(csv_rows, ranked, ranked_20min, .after = patch)
write_csv(coverage, file.path(output_dir, "sample_overview.csv"))
overview <- as.data.frame(t(as.data.frame(coverage[,-1])), stringsAsFactors = FALSE)
names(overview) <- as.character(coverage$patch)
print(overview)

# At p = 0.5 the exact two-sided binomial p-value is twice the smaller tail, capped at one.
# Work in log space because the result for patch 7.41 is too small for a numeric double.
wins <- coverage$radiant_wins
n <- coverage$n
log_within <- pmin(0, log(2) + pbinom(pmin(wins, n - wins), n, 0.5, log.p = TRUE))
between <- tidy(prop.test(wins, n, correct = FALSE))
log_between <- pchisq(between$statistic, between$parameter, lower.tail = FALSE, log.p = TRUE)
format_p <- function(log_p) {
  exponent <- floor(log_p / log(10))
  ifelse(log_p >= log(0.001), sprintf("%.4g", exp(log_p)),
         sprintf("%.4fe%d", exp(log_p - exponent * log(10)), as.integer(exponent)))
}
p_values <- tibble(
  comparison = c("7.41 Radiant vs 50%", "7.42 Radiant vs 50%", "7.41 vs 7.42 Radiant"),
  p_value = format_p(c(log_within, log_between))
)
print(p_values)
write_csv(p_values, file.path(output_dir, "overall_p_values.csv"))

chart_counts <- function(group, kind) {
  matches |> group_by(patch, stratum = as.character({{ group }})) |>
    summarise(n = n(), wins = sum(radiant_win), .groups = "drop") |> mutate(comparison = kind)
}
rates <- bind_rows(chart_counts("All matches", "Overall"),
                   chart_counts(duration_band, "Duration"), chart_counts(rank_band, "Rank")) |>
  rowwise() |>
  mutate(tidy(binom.test(wins, n)) |> select(radiant_rate = estimate, lo = conf.low, hi = conf.high)) |>
  ungroup() |> mutate(dire_rate = 1 - radiant_rate)
write_csv(rates, file.path(output_dir, "stratified_rates.csv"))

# Supplementary effect sizes, with approximate independent-binomial intervals.
# These are not cluster-adjusted and do not establish causal effects.
patch_effects <- coverage |>
  transmute(patch = as.character(patch), n, radiant_wins, dire_wins,
            radiant_pct, dire_pct,
            radiant_minus_dire_pp = radiant_pct - dire_pct)
write_csv(patch_effects, file.path(output_dir, "patch_effect_sizes.csv"))
p <- wins / n
delta <- p[2] - p[1]
se_delta <- sqrt(sum(p * (1 - p) / n))
patch_difference <- tibble(
  comparison = "7.42 minus 7.41 Radiant win rate",
  difference_pp = 100 * delta,
  lower_95_pp = 100 * (delta - qnorm(0.975) * se_delta),
  upper_95_pp = 100 * (delta + qnorm(0.975) * se_delta)
)
write_csv(patch_difference, file.path(output_dir, "patch_difference.csv"))
