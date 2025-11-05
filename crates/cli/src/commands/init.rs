use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow};
use clap::Args;
use dialoguer::{Input, MultiSelect, Select, theme::ColorfulTheme};
use indicatif::ProgressBar;
use owo_colors::OwoColorize;
use pathdiff::diff_paths;
use serde_json::Value;

use crate::commands::{CommandOutcome, CommandResult};
use crate::reporter::ConsoleReporter;
use crate::util::{
    canonicalize_path, create_spinner, normalize_relative_path, normalize_relative_path_buf,
};
use nocta_core::config::{read_config, write_config};
use nocta_core::deps::{
    DependencyScope, RequirementIssue, RequirementIssueReason, check_project_requirements,
    plan_dependency_install,
};
use nocta_core::framework::{AppStructure, FrameworkKind, detect_framework};
use nocta_core::fs::{file_exists, write_file};
use nocta_core::paths::resolve_component_path;
use nocta_core::registry::RegistryClient;
use nocta_core::rollback::rollback_changes;
use nocta_core::tailwind::{TailwindCheck, add_design_tokens_to_css, check_tailwind_installation};
use nocta_core::types::{
    AliasPrefixes, Aliases, Config, ExportsConfig, ExportsTargetConfig, TailwindConfig,
    WorkspaceConfig, WorkspaceKind, WorkspaceLink,
};
use nocta_core::workspace::{
    PackageManagerContext, PackageManagerKind, WORKSPACE_MANIFEST_FILE, WorkspaceManifest,
    WorkspaceManifestEntry, detect_package_manager, find_repo_root, load_workspace_manifest,
    repo_indicates_workspaces, write_workspace_manifest,
};

#[derive(Args, Debug, Clone)]
pub struct InitArgs {
    #[arg(long = "dry-run")]
    pub dry_run: bool,
}

const SHARED_UI_PEER_DEPENDENCIES: &[&str] = &["react", "react-dom"];
const SHARED_UI_DEV_DEPENDENCIES: &[&str] = &["@types/react"];

struct InitCommand<'a> {
    client: &'a RegistryClient,
    reporter: &'a ConsoleReporter,
    dry_run: bool,
    prefix: String,
    spinner: ProgressBar,
    created_paths: Vec<PathBuf>,
}

impl<'a> InitCommand<'a> {
    fn new(client: &'a RegistryClient, reporter: &'a ConsoleReporter, args: InitArgs) -> Self {
        let dry_run = args.dry_run;
        let prefix = if dry_run {
            "[dry-run] ".to_string()
        } else {
            String::new()
        };
        let spinner = create_spinner(format!("{}Initializing nocta-ui...", prefix));
        Self {
            client,
            reporter,
            dry_run,
            prefix,
            spinner,
            created_paths: Vec::new(),
        }
    }

    fn execute(&mut self) -> CommandResult {
        if read_config()?.is_some() {
            self.spinner.finish_and_clear();
            self.reporter
                .warn(format!("{}", "nocta.config.json already exists!".yellow()));
            self.reporter.info(format!(
                "{}",
                "Your project is already initialized.".dimmed()
            ));
            return Ok(CommandOutcome::NoOp);
        }

        let workspace = self.resolve_workspace()?;
        let tailwind = match self.ensure_tailwind_installed()? {
            Some(check) => check,
            None => return Ok(CommandOutcome::NoOp),
        };
        let framework_detection = match self.detect_framework(&workspace)? {
            Some(detection) => detection,
            None => return Ok(CommandOutcome::NoOp),
        };
        let requirements = self.client.registry_requirements()?;
        let required_dependencies: BTreeMap<String, String> = requirements
            .iter()
            .map(|(n, v)| (n.clone(), v.clone()))
            .collect();
        let manage_dependencies = dependencies_managed_in_workspace(&workspace);

        self.handle_dependency_checks(manage_dependencies, &workspace, &requirements)?;
        if !self.ensure_tailwind_v4(&tailwind)? {
            return Ok(CommandOutcome::NoOp);
        }

        let mut config = build_config(workspace.config_workspace.kind, &framework_detection)?;
        config.alias_prefixes = Some(AliasPrefixes {
            components: Some(config_alias_prefix(&framework_detection)),
            utils: Some(config_alias_prefix(&framework_detection)),
        });
        ensure_default_exports_config(&mut config, workspace.config_workspace.kind);
        config.workspace = Some(workspace.config_workspace.clone());

        self.write_config(&config)?;
        self.ensure_package_exports(&workspace, &config)?;
        self.handle_dependencies(manage_dependencies, &required_dependencies, &workspace)?;

        let (utils_created, icons_created) =
            self.sync_registry_assets(manage_dependencies, &config)?;
        let tokens_added = self.apply_tailwind_tokens(manage_dependencies, &workspace, &config)?;
        let tailwind_is_v4 = tailwind_v4(&tailwind);
        self.persist_workspace_manifest(&workspace)?;

        self.finish();
        self.print_summary(
            manage_dependencies,
            &workspace,
            &required_dependencies,
            utils_created,
            icons_created,
            tokens_added,
            tailwind_is_v4,
            &config,
            &framework_detection,
        );

        Ok(CommandOutcome::Completed)
    }

    fn resolve_workspace(&mut self) -> Result<WorkspaceResolution> {
        self.spinner
            .set_message(format!("{}Resolving workspace context...", self.prefix));
        let mut resolved: Option<Result<WorkspaceResolution>> = None;
        self.spinner.suspend(|| {
            resolved = Some(resolve_workspace_context());
        });
        resolved.expect("workspace resolution to run")
    }

    fn ensure_tailwind_installed(&mut self) -> Result<Option<TailwindCheck>> {
        self.spinner.set_message(format!(
            "{}Checking Tailwind CSS installation...",
            self.prefix
        ));
        let tailwind = check_tailwind_installation();
        if !tailwind.installed {
            self.spinner.finish_and_clear();
            print_tailwind_missing_message(self.reporter, &tailwind);
            Ok(None)
        } else {
            Ok(Some(tailwind))
        }
    }

    fn detect_framework(
        &mut self,
        workspace: &WorkspaceResolution,
    ) -> Result<Option<nocta_core::framework::FrameworkDetection>> {
        self.spinner
            .set_message(format!("{}Detecting project framework...", self.prefix));
        let detection = detect_framework();
        if workspace.config_workspace.kind == WorkspaceKind::App
            && detection.framework == FrameworkKind::Unknown
        {
            self.spinner.finish_and_clear();
            print_framework_unknown_message(self.reporter, &detection);
            return Ok(None);
        }
        Ok(Some(detection))
    }

    fn handle_dependency_checks(
        &mut self,
        manage_here: bool,
        workspace: &WorkspaceResolution,
        requirements: &HashMap<String, String>,
    ) -> Result<()> {
        if manage_here {
            self.spinner
                .set_message(format!("{}Validating project requirements...", self.prefix));
            let requirements_base = workspace
                .package_manager_context
                .workspace_root
                .as_ref()
                .map(|path| path.as_path())
                .unwrap_or_else(|| Path::new("."));
            let requirement_issues = check_project_requirements(requirements_base, requirements)?;
            if !requirement_issues.is_empty() {
                let dry_run = self.dry_run;
                let reporter = self.reporter;
                self.spinner.suspend(|| {
                    print_requirement_issues(reporter, &requirement_issues, dry_run);
                });
            }
            Ok(())
        } else {
            self.spinner.set_message(format!(
                "{}Skipping dependency installation for linked workspace...",
                self.prefix
            ));
            let reporter = self.reporter;
            self.spinner.suspend(|| {
                reporter.info(format!(
                    "{}",
                    "Detected linked shared UI workspace(s); skipping dependency checks and installation for this workspace."
                        .dimmed()
                ));
            });
            Ok(())
        }
    }

    fn ensure_tailwind_v4(&mut self, tailwind: &TailwindCheck) -> Result<bool> {
        if !tailwind_v4(tailwind) {
            self.spinner.finish_and_clear();
            print_tailwind_v4_required(self.reporter, tailwind);
            return Ok(false);
        }
        Ok(true)
    }

    fn write_config(&mut self, config: &Config) -> Result<()> {
        self.spinner
            .set_message(format!("{}Creating configuration...", self.prefix));
        if self.dry_run {
            self.reporter.blank();
            self.reporter.info(format!(
                "{}",
                "[dry-run] Would create configuration:".blue()
            ));
            self.reporter
                .info(format!("   {}", "nocta.config.json".dimmed()));
            Ok(())
        } else {
            write_config(config).context("failed to write nocta.config.json")?;
            self.created_paths.push(PathBuf::from("nocta.config.json"));
            Ok(())
        }
    }

    fn handle_dependencies(
        &mut self,
        manage_here: bool,
        required: &BTreeMap<String, String>,
        workspace: &WorkspaceResolution,
    ) -> Result<()> {
        if manage_here {
            let is_shared_ui = workspace.config_workspace.kind == WorkspaceKind::Ui;
            let mut install_groups: Vec<(DependencyScope, BTreeMap<String, String>)> = Vec::new();

            if is_shared_ui {
                let mut peer = BTreeMap::new();
                let mut dev = BTreeMap::new();
                let mut regular = BTreeMap::new();

                for (dep, version) in required {
                    let name = dep.as_str();
                    if SHARED_UI_PEER_DEPENDENCIES.contains(&name) {
                        peer.insert(dep.clone(), version.clone());
                    } else if SHARED_UI_DEV_DEPENDENCIES.contains(&name) {
                        dev.insert(dep.clone(), version.clone());
                    } else {
                        regular.insert(dep.clone(), version.clone());
                    }
                }

                if !peer.is_empty() {
                    install_groups.push((DependencyScope::Peer, peer));
                }
                if !dev.is_empty() {
                    install_groups.push((DependencyScope::Dev, dev));
                }
                if !regular.is_empty() {
                    install_groups.push((DependencyScope::Regular, regular));
                }
            } else if !required.is_empty() {
                let regular: BTreeMap<String, String> = required
                    .iter()
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect();
                install_groups.push((DependencyScope::Regular, regular));
            }

            if install_groups.is_empty() {
                return Ok(());
            }

            if self.dry_run {
                self.spinner.set_message(format!(
                    "{}[dry-run] Checking required dependencies...",
                    self.prefix
                ));
                self.reporter.blank();
            }

            for (scope, deps) in install_groups {
                if deps.is_empty() {
                    continue;
                }

                let scope_label = match scope {
                    DependencyScope::Peer => "peer dependencies",
                    DependencyScope::Dev => "dev dependencies",
                    DependencyScope::Regular => "dependencies",
                };

                let install_map: HashMap<String, String> =
                    deps.iter().map(|(k, v)| (k.clone(), v.clone())).collect();

                if self.dry_run {
                    self.reporter.info(format!(
                        "{}",
                        format!("[dry-run] Would install {}:", scope_label).blue()
                    ));
                    for (dep, version) in deps {
                        self.reporter
                            .info(format!("   {}", format!("{}@{}", dep, version).dimmed()));
                    }

                    if let Some(plan) = plan_dependency_install(
                        &install_map,
                        &workspace.package_manager_context,
                        scope,
                    )? {
                        self.reporter.info(format!(
                            "{}",
                            format!("   Command: {}", plan.command_line().join(" ")).dimmed()
                        ));
                    }
                    continue;
                }

                if let Some(plan) = plan_dependency_install(
                    &install_map,
                    &workspace.package_manager_context,
                    scope,
                )? {
                    let target = plan
                        .target_label()
                        .map(|label| format!(" {}", label))
                        .unwrap_or_default();

                    self.spinner.set_message(format!(
                        "{}Installing {} with {}{}...",
                        self.prefix,
                        scope_label,
                        plan.package_manager.as_str(),
                        target
                    ));

                    if let Err(err) = plan.execute() {
                        let command = plan.command_line().join(" ");
                        let reporter = self.reporter;
                        let scope_failure = match scope {
                            DependencyScope::Peer => "Peer dependencies installation failed",
                            DependencyScope::Dev => "Dev dependencies installation failed",
                            DependencyScope::Regular => "Dependencies installation failed",
                        };
                        self.spinner.suspend(|| {
                            reporter.warn(format!(
                                "{}",
                                format!("{}; you can install them manually", scope_failure)
                                    .yellow()
                            ));
                            reporter.info(format!("{}", format!("Run: {}", command).dimmed()));
                            reporter.error(format!("{}", format!("Error: {}", err).red()));
                        });
                    }
                }
            }
        } else if self.dry_run {
            self.reporter.blank();
            self.reporter.info(format!(
                "{}",
                "[dry-run] Would skip dependency installation in this workspace (managed via linked shared UI workspace)."
                    .blue()
            ));
        }
        Ok(())
    }

    fn ensure_package_exports(
        &mut self,
        workspace: &WorkspaceResolution,
        config: &Config,
    ) -> Result<()> {
        if workspace.config_workspace.kind != WorkspaceKind::Ui {
            return Ok(());
        }

        let Some(exports_cfg) = config.exports.as_ref().and_then(|cfg| cfg.components()) else {
            return Ok(());
        };

        let barrel = exports_cfg.barrel_path().trim();
        if barrel.is_empty() {
            return Ok(());
        }

        let pkg_path = workspace.workspace_root_abs.join("package.json");
        let contents = match fs::read_to_string(&pkg_path) {
            Ok(data) => data,
            Err(err) => {
                if err.kind() == io::ErrorKind::NotFound {
                    return Ok(());
                }
                return Err(anyhow!("failed to read {}: {}", pkg_path.display(), err));
            }
        };

        let mut json: Value =
            serde_json::from_str(&contents).context("failed to parse package.json")?;
        let export_value = sanitize_barrel_for_exports(barrel);
        let export_json = Value::String(export_value.clone());
        let mut changed = false;

        match json.get_mut("exports") {
            Some(Value::Object(map)) => match map.get(".") {
                Some(Value::String(current)) => {
                    if current != &export_value {
                        map.insert(".".into(), export_json.clone());
                        changed = true;
                    }
                }
                Some(Value::Object(_)) | Some(Value::Array(_)) => {
                    // Respect existing complex shape; do not modify.
                    return Ok(());
                }
                Some(_) => {
                    // Unsupported scalar type. Leave untouched.
                    return Ok(());
                }
                None => {
                    map.insert(".".into(), export_json.clone());
                    changed = true;
                }
            },
            Some(Value::String(current)) => {
                if current != &export_value {
                    json["exports"] = Value::String(export_value.clone());
                    changed = true;
                }
            }
            Some(_) => {
                // Unsupported shape; leave untouched.
                return Ok(());
            }
            None => {
                let mut map = serde_json::Map::new();
                map.insert(".".into(), export_json.clone());
                json["exports"] = Value::Object(map);
                changed = true;
            }
        }

        if !changed {
            return Ok(());
        }

        let display_path =
            diff_paths(&pkg_path, &workspace.repo_root).unwrap_or_else(|| pkg_path.clone());

        if self.dry_run {
            self.reporter.blank();
            self.reporter.info(format!(
                "{}",
                format!(
                    "[dry-run] Would set exports[\".\"] = \"{}\" in {}",
                    export_value,
                    display_path.display()
                )
                .blue()
            ));
            return Ok(());
        }

        let updated = serde_json::to_string_pretty(&json)?;
        fs::write(&pkg_path, updated)
            .with_context(|| format!("failed to write {}", pkg_path.display()))?;
        self.reporter.blank();
        self.reporter.info(format!(
            "{}",
            format!(
                "Configured exports[\".\"] = \"{}\" in {}",
                export_value,
                display_path.display()
            )
            .green()
        ));

        Ok(())
    }

    fn sync_registry_assets(
        &mut self,
        manage_here: bool,
        config: &Config,
    ) -> Result<(Option<PathBuf>, Option<PathBuf>)> {
        let utils_path = PathBuf::from(format!("{}.ts", config.aliases.utils.filesystem_path()));
        let icons_path = resolve_component_path("components/icons.ts", config);

        if manage_here {
            self.spinner
                .set_message(format!("{}Creating utility functions...", self.prefix));
            let utils_created = ensure_registry_asset(
                self.client,
                self.dry_run,
                self.reporter,
                "lib/utils.ts",
                &utils_path,
                &mut self.created_paths,
                "Utility functions",
            )?;

            self.spinner
                .set_message(format!("{}Creating base icons component...", self.prefix));
            let icons_created = ensure_registry_asset(
                self.client,
                self.dry_run,
                self.reporter,
                "icons/icons.ts",
                &icons_path,
                &mut self.created_paths,
                "Icons component",
            )?;
            Ok((
                utils_created.then_some(utils_path),
                icons_created.then_some(icons_path),
            ))
        } else {
            self.spinner.set_message(format!(
                "{}Skipping shared component helpers for linked workspace...",
                self.prefix
            ));
            let reporter = self.reporter;
            self.spinner.suspend(|| {
                reporter.info(format!(
                    "{}",
                    "Linked shared UI workspace manages shared helpers; skipping utility and icon scaffolding."
                        .dimmed()
                ));
            });
            Ok((None, None))
        }
    }

    fn apply_tailwind_tokens(
        &mut self,
        manage_here: bool,
        _workspace: &WorkspaceResolution,
        config: &Config,
    ) -> Result<bool> {
        let tailwind_css = config.tailwind.css.clone();
        if !manage_here {
            return Ok(false);
        }

        self.spinner
            .set_message(format!("{}Adding design tokens to CSS...", self.prefix));
        if self.dry_run {
            self.reporter.blank();
            self.reporter.info(format!(
                "{}",
                format!("[dry-run] Would update {}", tailwind_css).blue()
            ));
            return Ok(true);
        }

        let added = add_design_tokens_to_css(self.client, &tailwind_css)?;
        if added {
            self.created_paths.push(PathBuf::from(&tailwind_css));
        }
        Ok(added)
    }

    fn persist_workspace_manifest(&mut self, workspace: &WorkspaceResolution) -> Result<()> {
        if self.dry_run {
            return Ok(());
        }

        write_workspace_manifest(&workspace.repo_root, &workspace.manifest)
            .map_err(|err| anyhow!("failed to write {}: {}", WORKSPACE_MANIFEST_FILE, err))?;
        if !workspace.manifest_existed {
            self.created_paths.push(workspace.manifest_path.clone());
        }
        Ok(())
    }

    fn print_summary(
        &self,
        manage_dependencies_here: bool,
        workspace: &WorkspaceResolution,
        dependencies: &BTreeMap<String, String>,
        utils_path: Option<PathBuf>,
        icons_path: Option<PathBuf>,
        tokens_added: bool,
        tailwind_is_v4: bool,
        config: &Config,
        framework_detection: &nocta_core::framework::FrameworkDetection,
    ) {
        let framework_label = if framework_detection.framework == FrameworkKind::Unknown {
            format!(
                "Custom ({})",
                workspace_kind_label(workspace.config_workspace.kind)
            )
        } else {
            framework_info(framework_detection)
        };

        print_init_summary(
            self.reporter,
            self.dry_run,
            config,
            framework_label,
            dependencies,
            !manage_dependencies_here,
            utils_path.as_deref(),
            icons_path.as_deref(),
            tokens_added,
            tailwind_is_v4,
            workspace,
        );
    }

    fn rollback(&self) {
        if !self.dry_run && !self.created_paths.is_empty() {
            let _ = rollback_changes(&self.created_paths);
            self.reporter
                .warn(format!("{}", "Rolled back partial changes".yellow()));
        }
    }

    fn finish(&mut self) {
        self.spinner.finish_and_clear();
    }
}

#[derive(Debug)]
struct WorkspaceResolution {
    repo_root: PathBuf,
    workspace_root_abs: PathBuf,
    workspace_root_str: String,
    manifest_path: PathBuf,
    manifest_existed: bool,
    manifest: WorkspaceManifest,
    config_workspace: WorkspaceConfig,
    package_manager_context: PackageManagerContext,
    is_monorepo: bool,
}

fn resolve_workspace_context() -> Result<WorkspaceResolution> {
    let theme = ColorfulTheme::default();

    let current_dir =
        std::env::current_dir().context("failed to determine current working directory")?;
    let current_dir = canonicalize_path(&current_dir);

    let repo_root_candidate = find_repo_root(&current_dir).unwrap_or(current_dir.clone());
    let repo_root = canonicalize_path(&repo_root_candidate);

    let workspace_root_rel = match current_dir.strip_prefix(&repo_root) {
        Ok(rel) if rel.as_os_str().is_empty() => PathBuf::from("."),
        Ok(rel) => PathBuf::from(rel),
        Err(_) => PathBuf::from("."),
    };
    let workspace_root_str = normalize_relative_path(&workspace_root_rel);
    let workspace_root_abs = if workspace_root_str == "." {
        repo_root.clone()
    } else {
        repo_root.join(&workspace_root_rel)
    };

    let manifest_path = repo_root.join(WORKSPACE_MANIFEST_FILE);
    let manifest_existed = manifest_path.exists();
    let mut manifest = load_workspace_manifest(&repo_root)
        .map_err(|err| anyhow!("failed to read workspace manifest: {}", err))?
        .unwrap_or_default();

    let monorepo_detected = repo_indicates_workspaces(&repo_root)
        || workspace_root_str != "."
        || manifest.workspaces.len() > 1;

    let manifest_index = manifest
        .workspaces
        .iter()
        .position(|entry| entry.root == workspace_root_str);
    let existing_entry = manifest_index.and_then(|idx| manifest.workspaces.get(idx).cloned());

    let default_kind = existing_entry
        .as_ref()
        .map(|entry| entry.kind)
        .unwrap_or_else(|| guess_workspace_kind(&workspace_root_str));
    let workspace_kind = if existing_entry.is_some() || !monorepo_detected {
        default_kind
    } else {
        prompt_workspace_kind(&theme, default_kind)?
    };

    let mut package_name = existing_entry
        .as_ref()
        .and_then(|entry| entry.package_name.clone())
        .or_else(|| read_package_name_from(&workspace_root_abs));

    if !monorepo_detected {
        package_name = None;
    } else if package_name.is_none() {
        let input: String = Input::with_theme(&theme)
            .with_prompt("Workspace package name (leave blank to skip)")
            .allow_empty(true)
            .interact_text()?;
        let trimmed = input.trim();
        if !trimmed.is_empty() {
            package_name = Some(trimmed.to_string());
        }
    }

    let available_ui: Vec<WorkspaceManifestEntry> = manifest
        .workspaces
        .iter()
        .filter(|entry| entry.kind == WorkspaceKind::Ui && entry.root != workspace_root_str)
        .cloned()
        .collect();

    let linked_workspaces =
        if workspace_kind == WorkspaceKind::App && monorepo_detected && !available_ui.is_empty() {
            prompt_linked_workspaces(&theme, &available_ui, &workspace_root_abs, &repo_root)?
        } else {
            Vec::new()
        };

    let config_workspace = WorkspaceConfig {
        kind: workspace_kind,
        package_name: package_name.clone(),
        root: workspace_root_str.clone(),
        linked_workspaces,
    };

    let mut manifest_entry = WorkspaceManifestEntry {
        name: package_name
            .clone()
            .unwrap_or_else(|| workspace_root_str.clone()),
        kind: workspace_kind,
        package_name: package_name.clone(),
        root: workspace_root_str.clone(),
        config: join_relative_components(&workspace_root_str, "nocta.config.json"),
    };

    if manifest_entry.name.is_empty() {
        manifest_entry.name = workspace_root_str.clone();
    }

    if let Some(idx) = manifest_index {
        manifest.workspaces[idx] = manifest_entry.clone();
    } else {
        manifest.workspaces.push(manifest_entry.clone());
    }
    manifest.workspaces.sort_by(|a, b| a.root.cmp(&b.root));

    let package_manager = manifest
        .package_manager
        .or_else(|| detect_package_manager(&repo_root))
        .unwrap_or(PackageManagerKind::Npm);
    manifest.package_manager = Some(package_manager);
    if manifest.repo_root.is_none() {
        manifest.repo_root = Some(".".into());
    }

    let mut package_manager_context = PackageManagerContext::new(repo_root.clone());
    package_manager_context.package_manager = Some(package_manager);
    package_manager_context.workspace_root = Some(workspace_root_abs.clone());
    if let Some(ref pkg) = package_name {
        package_manager_context.workspace_package = Some(pkg.clone());
    }

    Ok(WorkspaceResolution {
        repo_root,
        workspace_root_abs,
        workspace_root_str,
        manifest_path,
        manifest_existed,
        manifest,
        config_workspace,
        package_manager_context,
        is_monorepo: monorepo_detected,
    })
}

fn guess_workspace_kind(path: &str) -> WorkspaceKind {
    let lower = path.to_ascii_lowercase();
    if lower.contains("/ui") || lower.contains("ui/") || lower.contains("packages/ui") {
        WorkspaceKind::Ui
    } else if lower.contains("package") && lower.contains("ui") {
        WorkspaceKind::Ui
    } else if lower.contains("lib") || lower.contains("library") {
        WorkspaceKind::Library
    } else {
        WorkspaceKind::App
    }
}

fn prompt_workspace_kind(
    theme: &ColorfulTheme,
    default_kind: WorkspaceKind,
) -> Result<WorkspaceKind> {
    let options = [
        "Application workspace",
        "Shared UI workspace",
        "Library workspace",
    ];
    let default_index = match default_kind {
        WorkspaceKind::App => 0,
        WorkspaceKind::Ui => 1,
        WorkspaceKind::Library => 2,
    };
    let selection = Select::with_theme(theme)
        .with_prompt("Configure this directory as")
        .items(&options)
        .default(default_index)
        .interact()?;

    let kind = match selection {
        0 => WorkspaceKind::App,
        1 => WorkspaceKind::Ui,
        _ => WorkspaceKind::Library,
    };
    Ok(kind)
}

fn prompt_linked_workspaces(
    theme: &ColorfulTheme,
    entries: &[WorkspaceManifestEntry],
    current_workspace_abs: &Path,
    repo_root: &Path,
) -> Result<Vec<WorkspaceLink>> {
    let items: Vec<String> = entries
        .iter()
        .map(|entry| {
            let label = entry
                .package_name
                .as_ref()
                .cloned()
                .unwrap_or_else(|| entry.name.clone());
            format!("{}  ({})", label, entry.root)
        })
        .collect();

    let selection = MultiSelect::with_theme(theme)
        .with_prompt("Link shared UI workspaces to this app (space to toggle)")
        .items(&items)
        .interact()?;

    let mut links = Vec::new();
    for index in selection {
        if let Some(entry) = entries.get(index) {
            let config_abs = repo_root.join(&entry.config);
            let relative_config = diff_paths(&config_abs, current_workspace_abs)
                .map(normalize_relative_path_buf)
                .unwrap_or_else(|| entry.config.clone());
            links.push(WorkspaceLink {
                kind: entry.kind,
                package_name: entry.package_name.clone(),
                root: entry.root.clone(),
                config: relative_config,
            });
        }
    }

    Ok(links)
}

fn read_package_name_from(dir: &Path) -> Option<String> {
    let pkg_path = dir.join("package.json");
    let contents = fs::read_to_string(pkg_path).ok()?;
    let value: Value = serde_json::from_str(&contents).ok()?;
    value
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn join_relative_components(base: &str, child: &str) -> String {
    if base == "." || base.is_empty() {
        child.to_string()
    } else {
        format!("{}/{}", base.trim_end_matches('/'), child)
    }
}

fn workspace_kind_label(kind: WorkspaceKind) -> &'static str {
    match kind {
        WorkspaceKind::App => "Application",
        WorkspaceKind::Ui => "Shared UI",
        WorkspaceKind::Library => "Library",
    }
}

pub fn run(client: &RegistryClient, reporter: &ConsoleReporter, args: InitArgs) -> CommandResult {
    let mut command = InitCommand::new(client, reporter, args);
    match command.execute() {
        Ok(outcome) => Ok(outcome),
        Err(err) => {
            command.finish();
            command.rollback();
            Err(err)
        }
    }
}

fn print_tailwind_missing_message(reporter: &ConsoleReporter, check: &TailwindCheck) {
    let _ = check;
    reporter.error(format!(
        "{}",
        "Tailwind CSS is required but not found!".red()
    ));
    reporter.error(format!(
        "{}",
        "Tailwind CSS is not installed or not found in node_modules".red()
    ));
    reporter.warn(format!("{}", "Please install Tailwind CSS first:".yellow()));
    reporter.info(format!("{}", "   npm install -D tailwindcss".dimmed()));
    reporter.info(format!("{}", "   # or".dimmed()));
    reporter.info(format!("{}", "   yarn add -D tailwindcss".dimmed()));
    reporter.info(format!("{}", "   # or".dimmed()));
    reporter.info(format!("{}", "   pnpm add -D tailwindcss".dimmed()));
    reporter.info(format!("{}", "   # or".dimmed()));
    reporter.info(format!("{}", "   bun add -D tailwindcss".dimmed()));
    reporter.info(format!(
        "{}",
        "Visit https://tailwindcss.com/docs/installation for setup guide".blue()
    ));
}

fn print_framework_unknown_message(
    reporter: &ConsoleReporter,
    detection: &nocta_core::framework::FrameworkDetection,
) {
    reporter.error(format!(
        "{}",
        "Unsupported project structure detected!".red()
    ));
    reporter.error(format!(
        "{}",
        "Could not detect a supported React framework".red()
    ));
    reporter.warn(format!("{}", "nocta-ui supports:".yellow()));
    reporter.info(format!(
        "{}",
        "   • Next.js (App Router or Pages Router)".dimmed()
    ));
    reporter.info(format!("{}", "   • Vite + React".dimmed()));
    reporter.info(format!(
        "{}",
        "   • React Router 7 (Framework Mode)".dimmed()
    ));
    reporter.info(format!("{}", "   • TanStack Start".dimmed()));
    reporter.info(format!("{}", "Detection details:".blue()));
    reporter.info(format!(
        "{}",
        format!(
            "   React dependency: {}",
            if detection.details.has_react_dependency {
                "✓"
            } else {
                "✗"
            }
        )
        .dimmed()
    ));
    reporter.info(format!(
        "{}",
        format!(
            "   Framework config: {}",
            if detection.details.has_config {
                "✓"
            } else {
                "✗"
            }
        )
        .dimmed()
    ));
    reporter.info(format!(
        "{}",
        format!(
            "   Config files found: {}",
            if detection.details.config_files.is_empty() {
                "none".to_string()
            } else {
                detection.details.config_files.join(", ")
            }
        )
        .dimmed()
    ));
    if !detection.details.has_react_dependency {
        reporter.warn(format!("{}", "Install React first:".yellow()));
        reporter.info(format!("{}", "   npm install react react-dom".dimmed()));
        reporter.info(format!(
            "{}",
            "   npm install -D @types/react @types/react-dom".dimmed()
        ));
    } else {
        reporter.warn(format!("{}", "Set up a supported framework:".yellow()));
        reporter.info(format!("{}", "   Next.js:".blue()));
        reporter.info(format!("{}", "     npx create-next-app@latest".dimmed()));
        reporter.info(format!("{}", "   Vite + React:".blue()));
        reporter.info(format!(
            "{}",
            "     npm create vite@latest . -- --template react-ts".dimmed()
        ));
        reporter.info(format!("{}", "   React Router 7:".blue()));
        reporter.info(format!(
            "{}",
            "     npx create-react-router@latest".dimmed()
        ));
        reporter.info(format!("{}", "   TanStack Start:".blue()));
        reporter.info(format!("{}", "     npm create tanstack@latest".dimmed()));
    }
}

fn print_requirement_issues(
    reporter: &ConsoleReporter,
    issues: &[RequirementIssue],
    dry_run: bool,
) {
    reporter.warn(format!(
        "{}",
        "Project dependencies are missing or out of date.".yellow()
    ));
    if dry_run {
        reporter.info(format!(
            "{}",
            "[dry-run] They would be installed automatically:".blue()
        ));
    } else {
        reporter.info(format!("{}", "Installing required versions...".blue()));
    }
    for issue in issues {
        reporter.warn(format!(
            "{}",
            format!("   {}: requires {}", issue.name, issue.required).yellow()
        ));
        if let Some(installed) = &issue.installed {
            reporter.info(format!(
                "{}",
                format!("      installed: {}", installed).dimmed()
            ));
        } else {
            reporter.info(format!("{}", "      installed: not found".dimmed()));
        }
        if let Some(declared) = &issue.declared {
            reporter.info(format!(
                "{}",
                format!("      declared: {}", declared).dimmed()
            ));
        }
        match issue.reason {
            RequirementIssueReason::Outdated => {
                reporter.info(format!(
                    "{}",
                    "      will be updated to a compatible version".dimmed()
                ));
            }
            RequirementIssueReason::Unknown => {
                reporter.info(format!(
                    "{}",
                    "      unable to determine installed version, forcing install".dimmed()
                ));
            }
            RequirementIssueReason::Missing => {
                reporter.info(format!("{}", "      will be installed".dimmed()));
            }
        }
    }
}

fn tailwind_v4(check: &TailwindCheck) -> bool {
    tailwind_major(check)
        .map(|major| major >= 4)
        .unwrap_or(false)
}

fn tailwind_major(check: &TailwindCheck) -> Option<u64> {
    check.version.as_ref().and_then(|version| {
        version
            .chars()
            .skip_while(|c| !c.is_ascii_digit())
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse()
            .ok()
    })
}

fn print_tailwind_v4_required(reporter: &ConsoleReporter, check: &TailwindCheck) {
    reporter.error(format!("{}", "Tailwind CSS v4 is required".red()));
    reporter.error(format!(
        "{}",
        format!(
            "Detected Tailwind version that is not v4: {}",
            check.version.clone().unwrap_or_else(|| "unknown".into())
        )
        .red()
    ));
    reporter.warn(format!("{}", "Please upgrade to Tailwind CSS v4:".yellow()));
    reporter.info(format!(
        "{}",
        "   npm install -D tailwindcss@latest".dimmed()
    ));
    reporter.info(format!("{}", "   # or".dimmed()));
    reporter.info(format!("{}", "   yarn add -D tailwindcss@latest".dimmed()));
    reporter.info(format!("{}", "   # or".dimmed()));
    reporter.info(format!("{}", "   pnpm add -D tailwindcss@latest".dimmed()));
    reporter.info(format!("{}", "   # or".dimmed()));
    reporter.info(format!("{}", "   bun add -D tailwindcss@latest".dimmed()));
}

fn ensure_registry_asset(
    client: &RegistryClient,
    dry_run: bool,
    reporter: &ConsoleReporter,
    asset_path: &str,
    target_path: &Path,
    created_paths: &mut Vec<PathBuf>,
    label: &str,
) -> Result<bool> {
    if file_exists(target_path) {
        reporter.warn(format!(
            "{}",
            format!(
                "{} already exists - skipping creation",
                target_path.display()
            )
            .yellow()
        ));
        return Ok(false);
    }

    if dry_run {
        reporter.info(format!(
            "{}",
            format!("[dry-run] Would create {}:", label).blue()
        ));
        reporter.info(format!("   {}", target_path.display().to_string().dimmed()));
        return Ok(true);
    }

    let asset = client
        .fetch_registry_asset(asset_path)
        .with_context(|| format!("failed to fetch registry asset {}", asset_path))?;
    write_file(target_path, &asset)
        .with_context(|| format!("failed to write {}", target_path.display()))?;
    created_paths.push(target_path.to_path_buf());
    Ok(true)
}

fn framework_info(detection: &nocta_core::framework::FrameworkDetection) -> String {
    match detection.framework {
        FrameworkKind::NextJs => {
            let router = match detection.details.app_structure {
                Some(AppStructure::AppRouter) => "App Router",
                Some(AppStructure::PagesRouter) => "Pages Router",
                _ => "Unknown Router",
            };
            format!(
                "Next.js {} ({})",
                detection.version.clone().unwrap_or_default(),
                router
            )
        }
        FrameworkKind::ViteReact => format!(
            "Vite {} + React",
            detection.version.clone().unwrap_or_default()
        ),
        FrameworkKind::ReactRouter => format!(
            "React Router {} (Framework Mode)",
            detection.version.clone().unwrap_or_default()
        ),
        FrameworkKind::TanstackStart => format!(
            "TanStack Start {}",
            detection.version.clone().unwrap_or_default()
        ),
        FrameworkKind::Unknown => "Unknown".into(),
    }
}

fn config_alias_prefix(detection: &nocta_core::framework::FrameworkDetection) -> String {
    if detection.framework == FrameworkKind::ReactRouter {
        "~".into()
    } else {
        "@".into()
    }
}

fn build_config(
    workspace_kind: WorkspaceKind,
    detection: &nocta_core::framework::FrameworkDetection,
) -> Result<Config> {
    match detection.framework {
        FrameworkKind::NextJs => {
            let app_router = detection.details.app_structure == Some(AppStructure::AppRouter);
            Ok(Config {
                schema: None,
                style: "default".into(),
                tailwind: TailwindConfig {
                    css: if app_router {
                        "app/globals.css".into()
                    } else {
                        "styles/globals.css".into()
                    },
                },
                aliases: Aliases {
                    components: "components/ui".into(),
                    utils: "lib/utils".into(),
                },
                alias_prefixes: None,
                exports: None,
                workspace: None,
            })
        }
        FrameworkKind::ViteReact => Ok(Config {
            schema: None,
            style: "default".into(),
            tailwind: TailwindConfig {
                css: "src/App.css".into(),
            },
            aliases: Aliases {
                components: "src/components/ui".into(),
                utils: "src/lib/utils".into(),
            },
            alias_prefixes: None,
            exports: None,
            workspace: None,
        }),
        FrameworkKind::ReactRouter => Ok(Config {
            schema: None,
            style: "default".into(),
            tailwind: TailwindConfig {
                css: "app/app.css".into(),
            },
            aliases: Aliases {
                components: "app/components/ui".into(),
                utils: "app/lib/utils".into(),
            },
            alias_prefixes: None,
            exports: None,
            workspace: None,
        }),
        FrameworkKind::TanstackStart => {
            let css_candidates = [
                "src/styles.css",
                "src/style.css",
                "src/global.css",
                "src/globals.css",
                "src/index.css",
                "src/app.css",
                "app/app.css",
                "app/styles.css",
                "app/globals.css",
                "app/global.css",
                "app/tailwind.css",
            ];
            let css_path = css_candidates
                .iter()
                .find(|path| file_exists(path))
                .copied()
                .unwrap_or("src/styles.css");

            Ok(Config {
                schema: None,
                style: "default".into(),
                tailwind: TailwindConfig {
                    css: css_path.into(),
                },
                aliases: Aliases {
                    components: "src/components/ui".into(),
                    utils: "src/lib/utils".into(),
                },
                alias_prefixes: None,
                exports: None,
                workspace: None,
            })
        }
        FrameworkKind::Unknown => build_shared_workspace_config(workspace_kind),
    }
}

fn build_shared_workspace_config(kind: WorkspaceKind) -> Result<Config> {
    if kind == WorkspaceKind::App {
        return Err(anyhow!("Unsupported framework configuration"));
    }

    let css_candidates = [
        "src/styles.css",
        "src/style.css",
        "src/global.css",
        "src/globals.css",
        "src/index.css",
        "src/app.css",
        "styles.css",
        "global.css",
        "index.css",
    ];

    let css_path = css_candidates
        .iter()
        .find(|path| file_exists(path))
        .copied()
        .unwrap_or("src/styles.css");

    let (components_path, utils_path) = match kind {
        WorkspaceKind::Ui | WorkspaceKind::Library => ("src/components/ui", "src/lib/utils"),
        WorkspaceKind::App => ("components", "lib/utils"),
    };

    Ok(Config {
        schema: None,
        style: "default".into(),
        tailwind: TailwindConfig {
            css: css_path.into(),
        },
        aliases: Aliases {
            components: components_path.into(),
            utils: utils_path.into(),
        },
        alias_prefixes: None,
        exports: None,
        workspace: None,
    })
}

fn ensure_default_exports_config(config: &mut Config, workspace_kind: WorkspaceKind) {
    if workspace_kind != WorkspaceKind::Ui {
        return;
    }

    let components_path = config.aliases.components.filesystem_path();
    let default_barrel = default_components_barrel_path(components_path);
    let exports = config.exports.get_or_insert_with(ExportsConfig::default);

    match exports.components_mut() {
        Some(target) => {
            if target.barrel.trim().is_empty() {
                target.barrel = default_barrel;
            }
        }
        None => {
            exports.components = Some(ExportsTargetConfig::new(default_barrel));
        }
    }
}

fn default_components_barrel_path(path: &str) -> String {
    let normalized = path.trim().trim_start_matches("./").trim_start_matches('/');

    if normalized.is_empty() {
        return "index.ts".into();
    }

    let mut segments = normalized.split('/');
    let first = segments.find(|segment| !segment.is_empty());

    match first {
        Some(segment) => format!("{}/index.ts", segment),
        None => "index.ts".into(),
    }
}

fn sanitize_barrel_for_exports(path: &str) -> String {
    let mut normalized = path.trim().replace('\\', "/");
    normalized = normalized.trim_start_matches("./").to_string();

    if normalized.is_empty() {
        return "./index.ts".into();
    }

    if normalized.starts_with('.') {
        return normalized;
    }

    format!("./{}", normalized)
}

fn dependencies_managed_in_workspace(workspace: &WorkspaceResolution) -> bool {
    if workspace.config_workspace.kind == WorkspaceKind::App
        && !workspace.config_workspace.linked_workspaces.is_empty()
    {
        return false;
    }
    true
}

fn print_init_summary(
    reporter: &ConsoleReporter,
    dry_run: bool,
    config: &Config,
    framework_info: String,
    dependencies: &BTreeMap<String, String>,
    dependencies_managed_elsewhere: bool,
    utils_path: Option<&Path>,
    icons_path: Option<&Path>,
    tokens_added: bool,
    tailwind_is_v4: bool,
    workspace: &WorkspaceResolution,
) {
    reporter.blank();
    reporter.info(format!("{}", "Configuration created:".green()));
    reporter.info(format!(
        "{}",
        format!("   nocta.config.json ({})", framework_info).dimmed()
    ));
    reporter.info(format!(
        "{}",
        format!(
            "   Workspace: {} (root: {})",
            workspace_kind_label(workspace.config_workspace.kind),
            workspace.workspace_root_str
        )
        .dimmed()
    ));
    reporter.info(format!(
        "{}",
        format!(
            "   Mode: {}",
            if workspace.is_monorepo {
                "monorepo"
            } else {
                "single workspace"
            }
        )
        .dimmed()
    ));
    if let Some(package) = workspace.config_workspace.package_name.as_deref() {
        reporter.info(format!("{}", format!("   Package: {}", package).dimmed()));
    }

    if !workspace.config_workspace.linked_workspaces.is_empty() {
        reporter.info(format!("{}", "\nLinked workspaces:".blue()));
        for link in &workspace.config_workspace.linked_workspaces {
            let label = link.package_name.as_deref().unwrap_or(&link.root);
            reporter.info(format!(
                "   {}",
                format!("{} ({})", label, link.config).dimmed()
            ));
        }
    }

    let manifest_display = diff_paths(&workspace.manifest_path, &workspace.workspace_root_abs)
        .map(normalize_relative_path_buf)
        .unwrap_or_else(|| workspace.manifest_path.display().to_string());
    let manifest_action = if dry_run {
        if workspace.manifest_existed {
            "would update"
        } else {
            "would create"
        }
    } else if workspace.manifest_existed {
        "updated"
    } else {
        "created"
    };
    reporter.info(format!(
        "{}",
        format!("   Manifest: {} ({})", manifest_display, manifest_action).dimmed()
    ));

    if dependencies_managed_elsewhere {
        reporter.info(format!(
            "\n{}",
            "Dependencies managed via linked shared UI workspace(s).".blue()
        ));
        if !dependencies.is_empty() {
            reporter.info(format!(
                "{}",
                "   Ensure the linked workspace includes:".dimmed()
            ));
            for (dep, version) in dependencies {
                reporter.info(format!("   {}", format!("{}@{}", dep, version).dimmed()));
            }
        }
    } else {
        let dep_heading = if dry_run {
            "[dry-run] Would install dependencies:".blue()
        } else {
            "Dependencies installed:".blue()
        };
        reporter.info(format!("\n{}", dep_heading));
        for (dep, version) in dependencies {
            reporter.info(format!("   {}", format!("{}@{}", dep, version).dimmed()));
        }
    }

    if let Some(path) = utils_path {
        reporter.info(format!("{}", "\nUtility functions created:".green()));
        reporter.info(format!("   {}", path.display().to_string().dimmed()));
        reporter.info(format!(
            "   {}",
            "• cn() function for className merging".dimmed()
        ));
    }

    if let Some(path) = icons_path {
        reporter.info(format!("{}", "\nIcons component created:".green()));
        reporter.info(format!("   {}", path.display().to_string().dimmed()));
        reporter.info(format!("   {}", "• Base Radix Icons mapping".dimmed()));
    }

    match (tokens_added, dependencies_managed_elsewhere) {
        (true, _) => {
            let heading = if dry_run {
                "[dry-run] Would add color variables:".green()
            } else {
                "Color variables added:".green()
            };
            reporter.info(format!("\n{}", heading));
            reporter.info(format!("   {}", config.tailwind.css.as_str().dimmed()));
            reporter.info(format!(
                "   {}",
                "• Semantic tokens (background, foreground, primary, border, etc.)".dimmed()
            ));
        }
        (false, true) => {
            reporter.info(format!(
                "\n{}",
                "Design tokens managed in linked shared UI workspace.".blue()
            ));
        }
        (false, false) => {
            reporter.info(format!(
                "\n{}",
                "Design tokens skipped (already exist or error occurred)".yellow()
            ));
        }
    }

    if tailwind_is_v4 {
        reporter.info(format!("\n{}", "Tailwind v4 detected!".blue()));
        reporter.info(format!(
            "{}",
            "   Make sure your CSS file includes @import \"tailwindcss\";".dimmed()
        ));
    }

    let final_heading = if dry_run {
        "[dry-run] You could then add components:".blue()
    } else {
        "You can now add components:".blue()
    };
    reporter.info(format!("\n{}", final_heading));
    reporter.info(format!("   {}", "npx nocta-ui add button".dimmed()));
}
