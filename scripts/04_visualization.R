# Original five plots. Output: results/generated/figures/.
pct <- function(x) paste0(round(100 * x), "%")
wrap_rank <- function(x) sub(" / ", " /\n", sub(" to ", "\nto ", x, fixed = TRUE), fixed = TRUE)
patch_labels <- labeller(patch = function(x) paste("Patch", x))
common <- theme_minimal(base_size = 20) +
  theme(plot.title = element_text(size = 29, face = "bold"),
        plot.subtitle = element_text(size = 17, margin = margin(b = 12)),
        strip.text = element_text(size = 22, face = "bold"),
        axis.text = element_text(size = 17, colour = "#26323A"), legend.position = "top",
        panel.spacing.x = grid::unit(2, "cm"), panel.grid.minor = element_blank(),
        panel.grid.major.x = element_blank(), plot.margin = margin(14, 20, 12, 16))
paired <- facet_wrap(~ patch, nrow = 1, labeller = patch_labels)
side_colours <- c(Radiant = "#22B578", Dire = "#F2626A")

win_chart <- function(kind, groups, title) {
  z <- rates |> filter(comparison == kind) |> arrange(match(stratum, groups), patch) |>
    mutate(tick = paste0(if (kind == "Rank") wrap_rank(stratum) else stratum, "\nn = ", format(n, big.mark = ",", trim = TRUE)),
           tick = factor(tick, levels = unique(tick)))
  bars <- bind_rows(
    transmute(z, patch, tick, side = "Radiant", rate = radiant_rate, low = lo, high = hi),
    transmute(z, patch, tick, side = "Dire", rate = dire_rate, low = 1 - hi, high = 1 - lo)
  ) |> mutate(side = factor(side, levels = names(side_colours)))
  overall <- kind == "Overall"
  limits <- if (overall) c(0.40, 0.60) else c(0.30, 0.70)
  bar_width <- if (overall) 0.48 else 0.66
  note <- "Error bars show 95% confidence intervals."
  if (overall) {
    p_lookup <- setNames(p_values$p_value, p_values$comparison)
    z$p_label <- paste0("Radiant vs 50%: p = ", p_lookup[paste(z$patch, "Radiant vs 50%")])
    note <- paste0("Radiant win rate, 7.41 vs 7.42: p = ",
                   p_lookup[["7.41 vs 7.42 Radiant"]], "     |     95% confidence intervals")
  }
  dodge <- position_dodge(width = 0.76)
  chart <- ggplot(bars, aes(tick, rate, fill = side, group = side)) +
    geom_col(position = dodge, width = bar_width) +
    geom_hline(yintercept = 0.5, linetype = "dashed", colour = "#46515C") +
    geom_errorbar(aes(ymin = low, ymax = high), position = dodge, width = 0.12) +
    geom_text(aes(y = pmin(limits[2] - 0.0375 * diff(limits),
                           pmax(limits[1] + 0.0425 * diff(limits), high + 0.035 * diff(limits))), label = sprintf("%.2f%%", 100 * rate)),
              position = dodge, size = 5.7, fontface = "bold") +
    facet_wrap(~ patch, nrow = 1, scales = "free_x", labeller = patch_labels) +
    scale_fill_manual(values = side_colours) +
    scale_y_continuous(breaks = seq(limits[1], limits[2], length.out = 5), labels = pct) +
    coord_cartesian(ylim = limits, expand = FALSE) +
    labs(title = title, subtitle = note,
         x = NULL, y = "Win rate", fill = NULL) + common
  if (overall) {
    chart <- chart + geom_text(data = z, aes(x = tick, label = p_label), y = 0.585,
                               inherit.aes = FALSE, size = 5.2, colour = "#26323A")
  }
  chart
}

bins <- matches |> count(patch, start = pmin(80, 5 * floor(duration_min / 5))) |>
  group_by(patch) |> mutate(share = n / sum(n)) |> ungroup()
duration_note <- with(coverage, paste(sprintf("%s: mean %.1f, median %.1f min", patch,
                                              mean_min, median_min), collapse = "     |     "))
duration_plot <- ggplot(bins, aes(start + 2.5, share)) +
  geom_col(width = 5, fill = "#378EF0", colour = "white", linewidth = 0.45) +
  geom_vline(data = coverage, aes(xintercept = mean_min), colour = "#B45309", linewidth = 1) +
  scale_x_continuous(breaks = c(20, 40, 60, 82.5), labels = c("20", "40", "60", "80+")) +
  scale_y_continuous(labels = pct, expand = expansion(mult = c(0, 0.06))) +
  labs(title = "Match duration", subtitle = duration_note,
       x = "Duration (minutes)  |  80+ includes all longer matches",
       y = "Share of matches") +
  paired + common

medals <- matches |> count(patch, medal_group, .drop = FALSE) |> group_by(patch) |>
  mutate(x = as.integer(medal_group), share = n / sum(n)) |> arrange(x, .by_group = TRUE) |> ungroup()
# A smooth curve through the seven observed shares, with no overshoot between medals.
curve_data <- medals |> group_by(patch) |>
  reframe(x_curve = seq(min(x), max(x), length.out = 181),
          share_curve = splinefunH(x, share, rep(0, length(x)))(x_curve))
medal_plot <- ggplot(medals, aes(x, share)) +
  geom_col(width = 0.69, fill = "#44C592") +
  geom_line(data = curve_data, aes(x_curve, share_curve), colour = "#164D41", linewidth = 1.2) +
  geom_point(shape = 21, size = 2.8, fill = "white", colour = "#164D41") +
  geom_text(aes(y = share / 2, label = sprintf("%.1f%%", 100 * share)), size = 5.4, fontface = "bold") +
  scale_x_continuous(breaks = seq_along(levels(matches$medal_group)), labels = wrap_rank(levels(matches$medal_group))) +
  scale_y_continuous(labels = pct, expand = expansion(mult = c(0, 0.12))) +
  labs(title = "Match rank distribution", x = NULL, y = "Share of matches",
       subtitle = paste("Mean medal:", paste(coverage$patch, coverage$mean_medal, collapse = "     |     "))) +
  paired + common + theme(axis.text.x = element_text(angle = 0, hjust = 0.5, size = 15))

plots <- list(overall_win_rate = win_chart("Overall", "All matches", "Radiant vs Dire"),
              duration_distribution = duration_plot, rank_distribution = medal_plot,
              win_rate_by_duration = win_chart("Duration", levels(matches$duration_band), "Win rate by duration"),
              win_rate_by_rank = win_chart("Rank", levels(matches$rank_band), "Win rate by rank"))
for (name in names(plots)) {
  ggsave(file.path(figure_dir, paste0(name, ".png")), plots[[name]],
         width = 17, height = 6.9, dpi = 180, bg = "white")
}
