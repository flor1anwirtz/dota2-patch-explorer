# Archived results

The original notebook compares 938,598 eligible 7.41 matches with **500,000** eligible 7.42 matches. The sample overview and p-value tables reproduce the precision displayed in the notebook. The five PNGs in `figures/` come from its embedded output. [Original R notebook](../../notebooks/patch_comparison_original.ipynb)

Rerunning `run_analysis.R` with R 4.5.0 reproduced the reported p-values and both overall totals, with 497,596 Radiant wins in 7.41 and 252,781 in 7.42. The R exporter also computed all nine duration-by-rank cells per patch directly from the same files. [Interactive explorer](../../docs/index.html)

`patch_difference_from_counts.csv` calculates the archived difference with a normal-approximation 95% interval, assuming independent matches. Repeated players, time clustering and sample selection can change the uncertainty. Current analysis runs write to `results/generated/`. [Input and sampling details](../../data/README.md)
