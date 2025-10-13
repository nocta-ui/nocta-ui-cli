use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result};
use semver::{Version, VersionReq};
use serde::Deserialize;

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

fn read_package_json() -> Option<PackageJson> {
    let data = fs::read_to_string("package.json").ok()?;
    serde_json::from_str(&data).ok()
}

fn declared_dependencies() -> HashMap<String, String> {
    read_package_json()
        .map(|pkg| {
            pkg.dependencies
                .into_iter()
                .chain(pkg.dev_dependencies.into_iter())
                .collect()
        })
        .unwrap_or_default()
}

fn node_module_package_json_path(name: &str) -> PathBuf {
    let mut path = PathBuf::from("node_modules");
    for segment in name.split('/') {
        path.push(segment);
    }
    path.push("package.json");
    path
}

fn read_installed_version(name: &str) -> Option<String> {
    let path = node_module_package_json_path(name);
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

pub fn get_installed_dependencies() -> Result<HashMap<String, String>> {
    let declared = declared_dependencies();
    let mut resolved = HashMap::new();

    for (name, spec) in declared {
        if let Some(actual) = read_installed_version(&name) {
            resolved.insert(name, actual);
        } else {
            resolved.insert(name, spec);
        }
    }

    Ok(resolved)
}

pub fn install_dependencies(dependencies: &HashMap<String, String>) -> Result<()> {
    if dependencies.is_empty() {
        return Ok(());
    }

    let package_manager = if Path::new("yarn.lock").exists() {
        "yarn"
    } else if Path::new("pnpm-lock.yaml").exists() {
        "pnpm"
    } else {
        "npm"
    };

    let mut deps_with_versions: Vec<String> = dependencies
        .iter()
        .map(|(name, version)| format!("{}@{}", name, version))
        .collect();
    deps_with_versions.sort();

    println!("Installing dependencies with {}...", package_manager);

    let status = match package_manager {
        "yarn" => Command::new("yarn")
            .arg("add")
            .args(&deps_with_versions)
            .status(),
        "pnpm" => Command::new("pnpm")
            .arg("add")
            .args(&deps_with_versions)
            .status(),
        _ => Command::new("npm")
            .arg("install")
            .args(&deps_with_versions)
            .status(),
    }
    .with_context(|| format!("failed to spawn {} to install dependencies", package_manager))?;

    if !status.success() {
        anyhow::bail!(
            "{} install command exited with status {}",
            package_manager,
            status
        );
    }

    Ok(())
}

pub fn check_project_requirements(
    requirements: &HashMap<String, String>,
) -> Result<Vec<RequirementIssue>> {
    let declared = declared_dependencies();
    let mut issues = Vec::new();

    for (name, required_range) in requirements {
        let module_path = node_module_package_json_path(name);

        if !module_path.exists() {
            issues.push(RequirementIssue {
                name: name.clone(),
                required: required_range.clone(),
                installed: None,
                declared: declared.get(name).cloned(),
                reason: RequirementIssueReason::Missing,
            });
            continue;
        }

        let installed_version = read_installed_version(name);
        let installed_spec = installed_version.clone().or_else(|| declared.get(name).cloned());

        let resolved_version = installed_spec
            .as_deref()
            .and_then(parse_version);
        let version_req = parse_version_req(required_range);

        let range_satisfied = match (&resolved_version, &version_req) {
            (Some(version), Some(req)) => req.matches(version),
            _ => false,
        };

        let installed_major = installed_spec
            .as_deref()
            .and_then(extract_major);
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
