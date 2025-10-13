use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub fn project_path<P: AsRef<Path>>(path: P) -> PathBuf {
    Path::new(".").join(path.as_ref())
}

pub fn file_exists<P: AsRef<Path>>(path: P) -> bool {
    project_path(path).exists()
}

pub fn ensure_parent_dir<P: AsRef<Path>>(path: P) -> io::Result<()> {
    let path = project_path(path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    Ok(())
}

pub fn write_file<P: AsRef<Path>>(path: P, contents: &str) -> io::Result<()> {
    let path = project_path(path.as_ref());
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    fs::write(path, contents)
}

pub fn append_file<P: AsRef<Path>>(path: P, contents: &str) -> io::Result<()> {
    let path = project_path(path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    file.write_all(contents.as_bytes())
}

pub fn read_file<P: AsRef<Path>>(path: P) -> io::Result<String> {
    fs::read_to_string(project_path(path))
}
