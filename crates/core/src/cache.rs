use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime};

use directories::BaseDirs;
use once_cell::sync::Lazy;
use tempfile::NamedTempFile;

const DEFAULT_CACHE_DIR_NAME: &str = "nocta-ui";
const MAX_CACHE_AGE_SECS: u64 = 30 * 24 * 60 * 60;
const METADATA_SUFFIX: &str = ".meta";

static CACHE_BASE_DIR: Lazy<PathBuf> = Lazy::new(resolve_cache_base_dir);

fn cache_base_dir() -> PathBuf {
    CACHE_BASE_DIR.clone()
}

fn normalized_rel_path(rel_path: &str) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in Path::new(rel_path).components() {
        if let Component::Normal(part) = component {
            normalized.push(part);
        }
    }

    if normalized.as_os_str().is_empty() {
        normalized.push("entry");
    }

    normalized
}

fn resolve_cache_path(rel_path: &str) -> PathBuf {
    cache_base_dir().join(normalized_rel_path(rel_path))
}

fn resolve_sidecar_path(rel_path: &str, suffix: &str) -> PathBuf {
    let mut normalized = normalized_rel_path(rel_path);
    let file_name = normalized
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| format!("{name}{suffix}"))
        .unwrap_or_else(|| format!("entry{suffix}"));
    normalized.set_file_name(file_name);
    cache_base_dir().join(normalized)
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

    if let Ok(metadata) = fs::metadata(&full_path) {
        if let Ok(modified) = metadata.modified() {
            if let Ok(elapsed) = SystemTime::now().duration_since(modified) {
                if elapsed > max_cache_age() {
                    purge_entry(rel_path);
                    return Ok(None);
                }

                if !accept_stale {
                    if let Some(ttl) = ttl {
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
    let parent_dir = full_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| cache_base_dir());
    let mut tmp = NamedTempFile::new_in(parent_dir)?;
    tmp.write_all(contents.as_bytes())?;
    tmp.flush()?;
    tmp.persist(full_path).map(|_| ()).map_err(|err| err.error)
}

pub fn read_cache_metadata(rel_path: &str) -> io::Result<Option<Vec<u8>>> {
    let path = metadata_path(rel_path);
    if !path.exists() {
        return Ok(None);
    }

    fs::read(path).map(Some)
}

pub fn write_cache_metadata(rel_path: &str, contents: &[u8]) -> io::Result<()> {
    let path = metadata_path(rel_path);
    ensure_parent_dir(&path)?;
    fs::write(path, contents)
}

pub fn remove_cache_metadata(rel_path: &str) -> io::Result<()> {
    let path = metadata_path(rel_path);
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

pub fn clear_cache() -> io::Result<()> {
    let dir = cache_base_dir();
    if dir.exists() {
        fs::remove_dir_all(dir)?;
    }
    Ok(())
}

fn metadata_path(rel_path: &str) -> PathBuf {
    resolve_sidecar_path(rel_path, METADATA_SUFFIX)
}

fn purge_entry(rel_path: &str) {
    let _ = fs::remove_file(resolve_cache_path(rel_path));
    let _ = remove_cache_metadata(rel_path);
}

fn current_cache_dir_override() -> Option<PathBuf> {
    env::var("NOCTA_CACHE_DIR")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
}

fn resolve_cache_base_dir() -> PathBuf {
    if let Some(explicit) = current_cache_dir_override() {
        return explicit;
    }

    if let Some(dirs) = BaseDirs::new() {
        return dirs.cache_dir().join(DEFAULT_CACHE_DIR_NAME);
    }

    env::temp_dir().join(DEFAULT_CACHE_DIR_NAME)
}

fn max_cache_age() -> Duration {
    Duration::from_secs(MAX_CACHE_AGE_SECS)
}
