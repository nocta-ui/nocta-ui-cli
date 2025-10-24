use std::path::{Path, PathBuf};
use std::time::Duration;

use indicatif::{ProgressBar, ProgressStyle};

pub fn canonicalize_path(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

pub fn normalize_relative_path(path: &Path) -> String {
    if path.as_os_str().is_empty() {
        return ".".into();
    }

    let mut normalized = path.to_string_lossy().replace('\\', "/");
    if normalized.is_empty() {
        normalized = ".".into();
    }
    if normalized == "." {
        return normalized;
    }
    if normalized.starts_with("./") {
        normalized = normalized.trim_start_matches("./").to_string();
        if normalized.is_empty() {
            normalized = ".".into();
        }
    }
    normalized
}

pub fn normalize_relative_path_buf(path: PathBuf) -> String {
    normalize_relative_path(&path)
}

pub fn create_spinner(message: impl Into<String>) -> ProgressBar {
    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::with_template("{spinner:.blue} {msg}")
            .unwrap()
            .tick_chars("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"),
    );
    pb.enable_steady_tick(Duration::from_millis(80));
    pb.set_message(message.into());
    pb
}

