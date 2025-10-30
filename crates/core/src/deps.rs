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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DependencyInstallPlan {
    pub package_manager: PackageManagerKind,
    pub program: String,
    pub args: Vec<String>,
    pub working_directory: PathBuf,
    pub workspace_descriptor: Option<String>,
    pub dependencies: Vec<String>,
    pub env: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DependencyInstallOutcome {
    Skipped,
    Executed(DependencyInstallPlan),
}

impl DependencyInstallPlan {
    pub fn command_line(&self) -> Vec<String> {
        let mut line = Vec::with_capacity(1 + self.args.len());
        line.push(self.program.clone());
        line.extend(self.args.clone());
        line
    }

    pub fn target_label(&self) -> Option<&str> {
        self.workspace_descriptor.as_deref()
    }

    pub fn execute(&self) -> Result<()> {
        let mut command = Command::new(&self.program);
        command.args(&self.args);
        command.current_dir(&self.working_directory);
        for (key, value) in &self.env {
            command.env(key, value);
        }
        let status = command.status().with_context(|| {
            let target = self
                .workspace_descriptor
                .as_deref()
                .map(|descriptor| format!(" {}", descriptor))
                .unwrap_or_default();
            format!(
                "failed to spawn {} to install dependencies{}",
                self.package_manager.as_str(),
                target
            )
        })?;

        if !status.success() {
            anyhow::bail!(
                "{} install command exited with status {}",
                self.package_manager.as_str(),
                status
            );
        }

        Ok(())
    }
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

pub fn plan_dependency_install(
    dependencies: &HashMap<String, String>,
    context: &PackageManagerContext,
) -> Result<Option<DependencyInstallPlan>> {
    if dependencies.is_empty() {
        return Ok(None);
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
        .map(|pkg| format!("workspace `{}`", pkg))
        .or_else(|| {
            context
                .workspace_root
                .as_ref()
                .map(|root| format!("directory {}", root.display()))
        });

    let repo_root = context.repo_root.clone();
    let workspace_root = context.workspace_root.clone();
    let workspace_package = context.workspace_package.clone();

    let mut env = Vec::new();

    let (program, args, working_directory) = match pm_kind {
        PackageManagerKind::Yarn => {
            let mut args = Vec::new();
            if let Some(package) = workspace_package.as_deref() {
                args.push("workspace".into());
                args.push(package.to_string());
                args.push("add".into());
                args.extend(deps_with_versions.clone());
                ("yarn".into(), args, repo_root.clone())
            } else {
                args.push("add".into());
                args.extend(deps_with_versions.clone());
                let working_dir = workspace_root.clone().unwrap_or_else(|| repo_root.clone());
                ("yarn".into(), args, working_dir)
            }
        }
        PackageManagerKind::Pnpm => {
            let mut args = vec!["add".into()];
            match (workspace_package.as_deref(), workspace_root.as_ref()) {
                (Some(package), _) => {
                    args.push("--filter".into());
                    args.push(package.to_string());
                    args.extend(deps_with_versions.clone());
                    ("pnpm".into(), args, repo_root.clone())
                }
                (None, Some(root)) => {
                    args.extend(deps_with_versions.clone());
                    ("pnpm".into(), args, root.clone())
                }
                _ => {
                    args.extend(deps_with_versions.clone());
                    ("pnpm".into(), args, repo_root.clone())
                }
            }
        }
        PackageManagerKind::Bun => {
            let mut args = vec!["add".into()];
            args.extend(deps_with_versions.clone());

            if let Some(root) = workspace_root.as_ref() {
                args.push("--cwd".into());
                args.push(root.to_string_lossy().into_owned());
            }

            if let Some(linker) = bun_install_linker(&repo_root) {
                env.push(("BUN_INSTALL_LINKER".into(), linker));
            }

            ("bun".into(), args, repo_root.clone())
        }
        PackageManagerKind::Npm => {
            let mut args = vec!["install".into()];
            args.extend(deps_with_versions.clone());
            if let Some(package) = workspace_package.as_deref() {
                args.push("--workspace".into());
                args.push(package.to_string());
                ("npm".into(), args, repo_root.clone())
            } else if let Some(root) = workspace_root.as_ref() {
                ("npm".into(), args, root.clone())
            } else {
                ("npm".into(), args, repo_root.clone())
            }
        }
    };

    Ok(Some(DependencyInstallPlan {
        package_manager: pm_kind,
        program,
        args,
        working_directory,
        workspace_descriptor,
        dependencies: deps_with_versions,
        env,
    }))
}

fn bun_install_linker(repo_root: &Path) -> Option<String> {
    const CANDIDATES: [&str; 3] = ["bunfig.toml", "bunfig.json", "bunfig"];

    for candidate in CANDIDATES {
        let path = repo_root.join(candidate);
        if let Ok(contents) = fs::read_to_string(&path) {
            if let Some(linker) = parse_bun_linker(&contents) {
                return Some(linker);
            }
        }
    }

    None
}

fn parse_bun_linker(contents: &str) -> Option<String> {
    let mut in_install_section = false;

    for line in contents.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if trimmed.starts_with('[') {
            in_install_section = trimmed == "[install]";
            continue;
        }

        if !in_install_section {
            continue;
        }

        if let Some((key, value)) = trimmed.split_once('=') {
            if key.trim() != "linker" {
                continue;
            }

            let value = value.split('#').next().unwrap_or("").trim();
            let value = value.trim_matches(|c| matches!(c, '"' | '\''));

            if value.is_empty() {
                continue;
            }

            return Some(value.to_string());
        }
    }

    None
}

pub fn install_dependencies(
    dependencies: &HashMap<String, String>,
    context: &PackageManagerContext,
) -> Result<DependencyInstallOutcome> {
    let plan = match plan_dependency_install(dependencies, context)? {
        Some(plan) => plan,
        None => return Ok(DependencyInstallOutcome::Skipped),
    };

    plan.execute()?;
    Ok(DependencyInstallOutcome::Executed(plan))
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
