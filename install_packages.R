# Run once if packages are missing: Rscript install_packages.R
packages <- c("httr", "jsonlite", "ggplot2", "dplyr", "readr", "broom")
missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing)) install.packages(missing, repos = "https://cloud.r-project.org")
if (packageVersion("dplyr") < "1.1.0") {
  install.packages("dplyr", repos = "https://cloud.r-project.org")
}
