use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result};
use semver::{Version, VersionReq};
use serde::Deserialize;

use crate::workspace::{PackageManagerContext, PackageManagerKind, detect_package_manager};

const YARN_PNP_MARKERS: [&str; 3] = [".pnp.cjs", ".pnp.js", ".pnp.loader.mjs"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RequirementIssueReason {
    Missing,
    Outdated,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequirementIssue {
    pub name: String,
    pub required: String,
    pub installed: Option<String>,
    pub declared: Option<String>,
    pub reason: RequirementIssueReason,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PackageJson {
    #[serde(default)]
    dependencies: HashMap<String, String>,
    #[serde(default)]
    dev_dependencies: HashMap<String, String>,
}

fn read_package_json(base: &Path) -> Option<PackageJson> {
    let path = base.join("package.json");
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

fn declared_dependencies(base: &Path) -> HashMap<String, String> {
    read_package_json(base)
        .map(|pkg| {
            pkg.dependencies
                .into_iter()
                .chain(pkg.dev_dependencies.into_iter())
                .collect()
        })
        .unwrap_or_default()
}

fn node_module_package_json_path(base: &Path, name: &str) -> Option<PathBuf> {
    let mut current = Some(base.to_path_buf());
    while let Some(dir) = current {
        let mut candidate = dir.join("node_modules");
        for segment in name.split('/') {
            candidate.push(segment);
        }
        candidate.push("package.json");
        if candidate.exists() {
            return Some(candidate);
        }
        current = dir.parent().map(|parent| parent.to_path_buf());
    }
    None
}

fn read_installed_version(base: &Path, name: &str) -> Option<String> {
    let path = node_module_package_json_path(base, name)?;
    let contents = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&contents).ok()?;
    value
        .get("version")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string())
}

fn normalize_version_str(version: &str) -> &str {
    version.trim_start_matches('v')
}

fn parse_version(version: &str) -> Option<Version> {
    Version::parse(normalize_version_str(version)).ok()
}

fn parse_version_req(range: &str) -> Option<VersionReq> {
    VersionReq::parse(range).ok()
}

fn extract_major(version: &str) -> Option<u64> {
    let mut digits = String::new();
    for ch in normalize_version_str(version).chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
        } else if !digits.is_empty() {
            break;
        }
    }
    if digits.is_empty() {
        None
    } else {
        digits.parse().ok()
    }
}

pub fn get_installed_dependencies_at<P: AsRef<Path>>(base: P) -> Result<HashMap<String, String>> {
    let base = base.as_ref();
    let declared = declared_dependencies(base);
    let mut resolved = HashMap::new();

    for (name, spec) in declared {
        if let Some(actual) = read_installed_version(base, &name) {
            resolved.insert(name, actual);
        } else {
            resolved.insert(name, spec);
        }
    }

    Ok(resolved)
}

pub fn get_installed_dependencies() -> Result<HashMap<String, String>> {
    get_installed_dependencies_at(Path::new("."))
}

pub fn install_dependencies(
    dependencies: &HashMap<String, String>,
    context: &PackageManagerContext,
) -> Result<()> {
    if dependencies.is_empty() {
        return Ok(());
    }

    let mut deps_with_versions: Vec<String> = dependencies
        .iter()
        .map(|(name, version)| format!("{}@{}", name, version))
        .collect();
    deps_with_versions.sort();

    let pm_kind = context
        .package_manager
        .or_else(|| detect_package_manager(&context.repo_root))
        .unwrap_or(PackageManagerKind::Npm);

    let workspace_descriptor = context
        .workspace_package
        .as_deref()
        .map(|pkg| format!(" workspace `{}`", pkg))
        .or_else(|| {
            context
                .workspace_root
                .as_ref()
                .map(|root| format!(" in {}", root.display()))
        })
        .unwrap_or_default();

    let message_suffix = if workspace_descriptor.is_empty() {
        String::new()
    } else {
        workspace_descriptor.clone()
    };

    println!(
        "Installing dependencies with {}{}...",
        pm_kind.as_str(),
        message_suffix
    );

    let repo_root = &context.repo_root;
    let workspace_root = context.workspace_root.as_ref();
    let workspace_package = context.workspace_package.as_deref();

    let status = match pm_kind {
        PackageManagerKind::Yarn => {
            let mut command = Command::new("yarn");
            if let Some(package) = workspace_package {
                command.arg("workspace");
                command.arg(package);
                command.arg("add");
            } else {
                command.arg("add");
            }
            command.args(&deps_with_versions);
            if workspace_package.is_some() {
                command.current_dir(repo_root);
            } else if let Some(root) = workspace_root {
                command.current_dir(root);
            } else {
                command.current_dir(repo_root);
            }
            command.status()
        }
        PackageManagerKind::Pnpm => {
            let mut command = Command::new("pnpm");
            command.arg("add");
            match (workspace_package, workspace_root) {
                (Some(package), _) => {
                    command.arg("--filter");
                    command.arg(package);
                    command.current_dir(repo_root);
                }
                (None, Some(root)) => {
                    command.current_dir(root);
                }
                _ => {
                    command.current_dir(repo_root);
                }
            }
            command.args(&deps_with_versions);
            command.status()
        }
        PackageManagerKind::Bun => {
            let mut command = Command::new("bun");
            command.arg("add");
            command.args(&deps_with_versions);
            if let Some(root) = workspace_root {
                command.arg("--cwd");
                command.arg(root.as_os_str());
                command.current_dir(repo_root);
            } else {
                command.current_dir(repo_root);
            }
            command.status()
        }
        PackageManagerKind::Npm => {
            let mut command = Command::new("npm");
            command.arg("install");
            command.args(&deps_with_versions);
            if let Some(package) = workspace_package {
                command.arg("--workspace");
                command.arg(package);
                command.current_dir(repo_root);
            } else if let Some(root) = workspace_root {
                command.current_dir(root);
            } else {
                command.current_dir(repo_root);
            }
            command.status()
        }
    }
    .with_context(|| {
        let target = workspace_package
            .map(|pkg| format!(" workspace `{}`", pkg))
            .or_else(|| workspace_root.map(|root| format!(" directory {}", root.display())))
            .unwrap_or_else(|| " project root".to_string());
        format!(
            "failed to spawn {} to install dependencies in{}",
            pm_kind.as_str(),
            target
        )
    })?;

    if !status.success() {
        anyhow::bail!(
            "{} install command exited with status {}",
            pm_kind.as_str(),
            status
        );
    }

    Ok(())
}

pub fn check_project_requirements(
    base: &Path,
    requirements: &HashMap<String, String>,
) -> Result<Vec<RequirementIssue>> {
    let declared = declared_dependencies(base);
    let uses_yarn_pnp = detect_yarn_pnp(base);
    let mut issues = Vec::new();

    for (name, required_range) in requirements {
        let module_path = node_module_package_json_path(base, name);

        if module_path.is_none() {
            if uses_yarn_pnp {
                if let Some(declared_spec) = declared.get(name) {
                    if yarn_declared_satisfies(required_range, declared_spec) {
                        continue;
                    }
                }
            }

            issues.push(RequirementIssue {
                name: name.clone(),
                required: required_range.clone(),
                installed: None,
                declared: declared.get(name).cloned(),
                reason: if declared.contains_key(name) {
                    RequirementIssueReason::Outdated
                } else {
                    RequirementIssueReason::Missing
                },
            });
            continue;
        }

        let installed_version = read_installed_version(base, name);
        let installed_spec = installed_version
            .clone()
            .or_else(|| declared.get(name).cloned());

        let resolved_version = installed_spec.as_deref().and_then(parse_version);
        let version_req = parse_version_req(required_range);

        let range_satisfied = match (&resolved_version, &version_req) {
            (Some(version), Some(req)) => req.matches(version),
            _ => false,
        };

        let installed_major = installed_spec.as_deref().and_then(extract_major);
        let required_major = extract_major(required_range);

        let higher_version_satisfied = match (installed_major, required_major) {
            (Some(installed), Some(required)) => installed > required,
            _ => false,
        };

        if range_satisfied || higher_version_satisfied {
            continue;
        }

        let installed_string = resolved_version.as_ref().map(|v| v.to_string());
        let declared_string = match (&installed_string, installed_spec) {
            (Some(resolved), Some(spec)) if resolved == &spec => None,
            (_, Some(spec)) => Some(spec),
            _ => None,
        };

        let reason = if resolved_version.is_some() {
            RequirementIssueReason::Outdated
        } else {
            RequirementIssueReason::Unknown
        };

        issues.push(RequirementIssue {
            name: name.clone(),
            required: required_range.clone(),
            installed: installed_string,
            declared: declared_string,
            reason,
        });
    }

    Ok(issues)
}

pub fn missing_dependencies(
    required: &HashMap<String, String>,
    installed: &HashMap<String, String>,
) -> BTreeMap<String, String> {
    let mut missing = BTreeMap::new();
    for (name, version) in required {
        if !installed.contains_key(name) {
            missing.insert(name.clone(), version.clone());
        }
    }
    missing
}

fn detect_yarn_pnp(base: &Path) -> bool {
    let mut current = Some(base.to_path_buf());

    while let Some(dir) = current {
        for marker in &YARN_PNP_MARKERS {
            if dir.join(marker).exists() {
                return true;
            }
        }

        let yarnrc = dir.join(".yarnrc.yml");
        if yarnrc.exists() {
            if let Ok(contents) = fs::read_to_string(&yarnrc) {
                if contents
                    .lines()
                    .any(|line| line.trim().contains("nodeLinker: pnp"))
                {
                    return true;
                }
            }
        }

        current = dir.parent().map(|p| p.to_path_buf());
    }

    false
}

fn yarn_declared_satisfies(required_range: &str, declared_spec: &str) -> bool {
    if let Some(declared_version) = extract_version_from_spec(declared_spec) {
        if let Some(required_req) = parse_version_req(required_range) {
            if required_req.matches(&declared_version) {
                return true;
            }
        }
    }

    if let Some(required_version) = extract_version_from_spec(required_range) {
        if let Some(declared_req) = parse_version_req(declared_spec) {
            if declared_req.matches(&required_version) {
                return true;
            }
        }
    }

    false
}

fn extract_version_from_spec(spec: &str) -> Option<Version> {
    let start = spec.find(|c: char| c.is_ascii_digit())?;
    let numeric = &spec[start..];
    let mut end = numeric.len();
    for (idx, ch) in numeric.char_indices() {
        if !(ch.is_ascii_digit() || ch == '.' || ch == '-' || ch == '+') {
            end = idx;
            break;
        }
    }
    let candidate = &numeric[..end];
    Version::parse(candidate).ok()
}
