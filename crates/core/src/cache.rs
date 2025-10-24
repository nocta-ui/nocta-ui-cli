use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use crate::workspace::{find_repo_root, WORKSPACE_MANIFEST_FILE};

const DEFAULT_CACHE_DIR: &str = ".nocta-cache";

fn current_dir() -> PathBuf {
    env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn detect_project_root(start: &Path) -> PathBuf {
    let mut current = start.to_path_buf();

    loop {
        if current.join(DEFAULT_CACHE_DIR).exists() {
            return current;
        }

        if current.join(WORKSPACE_MANIFEST_FILE).exists() {
            return current;
        }

        if !current.pop() {
            break;
        }
    }

    find_repo_root(start).unwrap_or_else(|| start.to_path_buf())
}

fn cache_base_dir() -> PathBuf {
    env::var("NOCTA_CACHE_DIR")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| detect_project_root(&current_dir()).join(DEFAULT_CACHE_DIR))
}

fn resolve_cache_path(rel_path: &str) -> PathBuf {
    let safe_rel = rel_path.trim_start_matches('/');
    cache_base_dir().join(safe_rel)
}

pub fn cache_dir() -> PathBuf {
    cache_base_dir()
}

fn ensure_parent_dir(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    Ok(())
}

pub fn read_cache_text(
    rel_path: &str,
    ttl: Option<Duration>,
    accept_stale: bool,
) -> io::Result<Option<String>> {
    let full_path = resolve_cache_path(rel_path);
    if !full_path.exists() {
        return Ok(None);
    }

    if !accept_stale {
        if let Some(ttl) = ttl {
            if let Ok(metadata) = fs::metadata(&full_path) {
                if let Ok(modified) = metadata.modified() {
                    if let Ok(elapsed) = SystemTime::now().duration_since(modified) {
                        if elapsed > ttl {
                            return Ok(None);
                        }
                    }
                }
            }
        }
    }

    fs::read_to_string(full_path).map(Some)
}

pub fn write_cache_text(rel_path: &str, contents: &str) -> io::Result<()> {
    let full_path = resolve_cache_path(rel_path);
    ensure_parent_dir(&full_path)?;
    fs::write(full_path, contents)
}
