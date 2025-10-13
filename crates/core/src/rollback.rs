use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::Result;

pub fn rollback_changes<P: AsRef<Path>>(paths: &[P]) -> Result<()> {
    let mut unique = HashSet::new();
    for path in paths {
        unique.insert(normalize_path(path.as_ref()));
    }

    for path in unique {
        if path.exists() {
            let _ = if path.is_dir() {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_file(&path)
            };
        }
    }

    Ok(())
}

fn normalize_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}
