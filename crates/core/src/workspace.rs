use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::config::ensure_parent_dir;
use crate::types::WorkspaceKind;

pub const WORKSPACE_MANIFEST_FILE: &str = "nocta.workspace.json";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PackageManagerKind {
    Npm,
    Pnpm,
    Yarn,
    Bun,
}

impl PackageManagerKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            PackageManagerKind::Npm => "npm",
            PackageManagerKind::Pnpm => "pnpm",
            PackageManagerKind::Yarn => "yarn",
            PackageManagerKind::Bun => "bun",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "npm" => Some(PackageManagerKind::Npm),
            "pnpm" => Some(PackageManagerKind::Pnpm),
            "yarn" => Some(PackageManagerKind::Yarn),
            "bun" => Some(PackageManagerKind::Bun),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PackageManagerContext {
    pub repo_root: PathBuf,
    pub workspace_root: Option<PathBuf>,
    pub workspace_package: Option<String>,
    pub package_manager: Option<PackageManagerKind>,
}

impl PackageManagerContext {
    pub fn new(repo_root: impl Into<PathBuf>) -> Self {
        Self {
            repo_root: repo_root.into(),
            workspace_root: None,
            workspace_package: None,
            package_manager: None,
        }
    }

    pub fn with_workspace_root(mut self, root: impl Into<PathBuf>) -> Self {
        self.workspace_root = Some(root.into());
        self
    }

    pub fn with_workspace_package(mut self, package: impl Into<String>) -> Self {
        self.workspace_package = Some(package.into());
        self
    }

    pub fn with_package_manager(mut self, manager: PackageManagerKind) -> Self {
        self.package_manager = Some(manager);
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceManifestEntry {
    pub name: String,
    pub kind: WorkspaceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_name: Option<String>,
    pub root: String,
    pub config: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceManifest {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workspaces: Vec<WorkspaceManifestEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_manager: Option<PackageManagerKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_root: Option<String>,
}

#[derive(Debug, Error)]
pub enum WorkspaceManifestError {
    #[error("failed to read workspace manifest: {0}")]
    Read(io::Error),
    #[error("failed to parse workspace manifest: {0}")]
    Parse(serde_json::Error),
    #[error("failed to serialize workspace manifest: {0}")]
    Serialize(serde_json::Error),
    #[error("failed to write workspace manifest: {0}")]
    Write(io::Error),
}

pub fn load_workspace_manifest(
    root: &Path,
) -> Result<Option<WorkspaceManifest>, WorkspaceManifestError> {
    let path = root.join(WORKSPACE_MANIFEST_FILE);
    if !path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&path).map_err(WorkspaceManifestError::Read)?;
    if contents.trim().is_empty() {
        return Ok(None);
    }

    let manifest = serde_json::from_str(&contents).map_err(WorkspaceManifestError::Parse)?;
    Ok(Some(manifest))
}

pub fn write_workspace_manifest(
    root: &Path,
    manifest: &WorkspaceManifest,
) -> Result<(), WorkspaceManifestError> {
    let path = root.join(WORKSPACE_MANIFEST_FILE);
    ensure_parent_dir(&path).map_err(WorkspaceManifestError::Write)?;

    let json = serde_json::to_string_pretty(manifest).map_err(WorkspaceManifestError::Serialize)?;
    fs::write(path, json).map_err(WorkspaceManifestError::Write)
}

pub fn find_repo_root(start: &Path) -> Option<PathBuf> {
    let absolute_start = if start.is_absolute() {
        start.to_path_buf()
    } else {
        match start.canonicalize() {
            Ok(path) => path,
            Err(_) => {
                if let Ok(cwd) = std::env::current_dir() {
                    cwd.join(start)
                } else {
                    start.to_path_buf()
                }
            }
        }
    };

    let mut current = absolute_start.clone();
    let mut fallback: Option<PathBuf> = None;

    loop {
        if matches_repo_root(&current) {
            return Some(current);
        }

        if current.join("package.json").exists() {
            fallback.get_or_insert_with(|| current.clone());
        }

        if !current.pop() {
            break;
        }
    }

    fallback.or_else(|| Some(absolute_start))
}

fn matches_repo_root(path: &Path) -> bool {
    has_workspace_manifest(path)
        || path.join("pnpm-workspace.yaml").exists()
        || path.join("turbo.json").exists()
        || package_json_has_workspaces(path)
}

fn has_workspace_manifest(path: &Path) -> bool {
    path.join(WORKSPACE_MANIFEST_FILE).exists()
}

fn package_json_has_workspaces(path: &Path) -> bool {
    let pkg_path = path.join("package.json");
    if !pkg_path.exists() {
        return false;
    }

    match fs::read_to_string(&pkg_path) {
        Ok(contents) => match serde_json::from_str::<Value>(&contents) {
            Ok(value) => {
                if let Some(workspaces) = value.get("workspaces") {
                    if workspaces.is_array() {
                        !workspaces.as_array().unwrap().is_empty()
                    } else if workspaces.is_object() {
                        workspaces
                            .get("packages")
                            .and_then(Value::as_array)
                            .map(|packages| !packages.is_empty())
                            .unwrap_or(true)
                    } else if workspaces.is_string() {
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            Err(_) => false,
        },
        Err(_) => false,
    }
}

pub fn detect_package_manager(root: &Path) -> Option<PackageManagerKind> {
    let pnpm_lock = root.join("pnpm-lock.yaml");
    if pnpm_lock.exists() {
        return Some(PackageManagerKind::Pnpm);
    }

    let yarn_lock = root.join("yarn.lock");
    if yarn_lock.exists() {
        return Some(PackageManagerKind::Yarn);
    }

    for candidate in &["bun.lockb", "bun.lock"] {
        if root.join(candidate).exists() {
            return Some(PackageManagerKind::Bun);
        }
    }

    let npm_lock = root.join("package-lock.json");
    if npm_lock.exists() {
        return Some(PackageManagerKind::Npm);
    }

    let pkg_path = root.join("package.json");
    if pkg_path.exists() {
        if let Ok(contents) = fs::read_to_string(pkg_path) {
            if let Ok(value) = serde_json::from_str::<Value>(&contents) {
                if let Some(manager) = value
                    .get("packageManager")
                    .and_then(Value::as_str)
                    .and_then(|spec| spec.split('@').next())
                {
                    if let Some(kind) = PackageManagerKind::from_name(manager) {
                        return Some(kind);
                    }
                }
            }
        }
    }

    None
}

pub fn repo_indicates_workspaces(root: &Path) -> bool {
    has_workspace_manifest(root)
        || root.join("pnpm-workspace.yaml").exists()
        || root.join("turbo.json").exists()
        || package_json_has_workspaces(root)
}

pub fn resolve_workspace_by_package<'a>(
    manifest: &'a WorkspaceManifest,
    package_name: &str,
) -> Option<&'a WorkspaceManifestEntry> {
    manifest.workspaces.iter().find(|entry| {
        entry.package_name.as_deref() == Some(package_name) || entry.name == package_name
    })
}

pub fn resolve_workspace_by_kind<'a>(
    manifest: &'a WorkspaceManifest,
    kind: WorkspaceKind,
) -> Option<&'a WorkspaceManifestEntry> {
    manifest.workspaces.iter().find(|entry| entry.kind == kind)
}

pub fn resolve_workspace_by_config<'a>(
    manifest: &'a WorkspaceManifest,
    config_path: &str,
) -> Option<&'a WorkspaceManifestEntry> {
    manifest
        .workspaces
        .iter()
        .find(|entry| entry.config == config_path)
}
