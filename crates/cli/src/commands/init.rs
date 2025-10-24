use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use clap::Args;
use dialoguer::{Input, MultiSelect, Select, theme::ColorfulTheme};
use indicatif::{ProgressBar, ProgressStyle};
use owo_colors::OwoColorize;
use pathdiff::diff_paths;
use serde_json::Value;

use nocta_core::config::{read_config, write_config};
use nocta_core::deps::{
    RequirementIssue, RequirementIssueReason, check_project_requirements, install_dependencies,
};
use nocta_core::framework::{AppStructure, FrameworkKind, detect_framework};
use nocta_core::fs::{file_exists, write_file};
use nocta_core::paths::resolve_component_path;
use nocta_core::registry::RegistryClient;
use nocta_core::rollback::rollback_changes;
use nocta_core::tailwind::{TailwindCheck, add_design_tokens_to_css, check_tailwind_installation};
use nocta_core::types::{
    AliasPrefixes, Aliases, Config, TailwindConfig, WorkspaceConfig, WorkspaceKind, WorkspaceLink,
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

fn canonicalize_path(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn normalize_relative_path(path: &Path) -> String {
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

fn normalize_relative_path_buf(path: PathBuf) -> String {
    normalize_relative_path(&path)
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

pub fn run(client: &RegistryClient, args: InitArgs) -> Result<()> {
    let dry_run = args.dry_run;
    let prefix = if dry_run { "[dry-run] " } else { "" };
    let mut created_paths: Vec<PathBuf> = Vec::new();

    let pb = create_spinner(format!("{}Initializing nocta-ui...", prefix));

    let result = init_inner(client, dry_run, prefix, pb.clone(), &mut created_paths);

    match result {
        Ok(_) => Ok(()),
        Err(err) => {
            pb.finish_and_clear();
            if !dry_run && !created_paths.is_empty() {
                let _ = rollback_changes(&created_paths);
                println!("{}", "Rolled back partial changes".yellow());
            }
            Err(err)
        }
    }
}

fn init_inner(
    client: &RegistryClient,
    dry_run: bool,
    prefix: &str,
    pb: ProgressBar,
    created_paths: &mut Vec<PathBuf>,
) -> Result<()> {
    if read_config()?.is_some() {
        pb.finish_and_clear();
        println!("{}", "nocta.config.json already exists!".yellow());
        println!("{}", "Your project is already initialized.".dimmed());
        return Ok(());
    }

    let workspace = {
        let mut resolved: Option<Result<WorkspaceResolution>> = None;
        pb.suspend(|| {
            resolved = Some(resolve_workspace_context());
        });
        match resolved.expect("workspace resolution to run") {
            Ok(value) => value,
            Err(err) => return Err(err),
        }
    };

    pb.set_message(format!("{}Checking Tailwind CSS installation...", prefix));
    let tailwind = check_tailwind_installation();

    if !tailwind.installed {
        pb.finish_and_clear();
        print_tailwind_missing_message(&tailwind);
        return Ok(());
    }

    pb.set_message(format!("{}Detecting project framework...", prefix));
    let framework_detection = detect_framework();

    if workspace.config_workspace.kind == WorkspaceKind::App
        && framework_detection.framework == FrameworkKind::Unknown
    {
        pb.finish_and_clear();
        print_framework_unknown_message(&framework_detection);
        return Ok(());
    }

    let requirements = client.registry_requirements()?;
    let required_dependencies: BTreeMap<String, String> = requirements
        .iter()
        .map(|(name, version)| (name.clone(), version.clone()))
        .collect();

    let manage_dependencies_here = dependencies_managed_in_workspace(&workspace);
    if manage_dependencies_here {
        pb.set_message(format!("{}Validating project requirements...", prefix));
        let requirements_base = workspace
            .package_manager_context
            .workspace_root
            .as_ref()
            .map(|path| path.as_path())
            .unwrap_or_else(|| Path::new("."));
        let requirement_issues = check_project_requirements(requirements_base, &requirements)?;
        if !requirement_issues.is_empty() {
            pb.suspend(|| {
                print_requirement_issues(&requirement_issues, dry_run);
            });
        }
    } else {
        pb.set_message(format!(
            "{}Skipping dependency installation for linked workspace...",
            prefix
        ));
        pb.suspend(|| {
            println!(
                "{}",
                "Detected linked shared UI workspace(s); skipping dependency checks and installation for this workspace."
                    .dimmed()
            );
        });
    }

    let is_tailwind_v4 = tailwind_v4(&tailwind);
    if !is_tailwind_v4 {
        pb.finish_and_clear();
        print_tailwind_v4_required(&tailwind);
        return Ok(());
    }

    pb.set_message(format!("{}Creating configuration...", prefix));

    let mut config = build_config(workspace.config_workspace.kind, &framework_detection)?;
    config.alias_prefixes = Some(AliasPrefixes {
        components: Some(config_alias_prefix(&framework_detection)),
        utils: Some(config_alias_prefix(&framework_detection)),
    });
    config.workspace = Some(workspace.config_workspace.clone());

    if dry_run {
        println!("\n{}", "[dry-run] Would create configuration:".blue());
        println!("   {}", "nocta.config.json".dimmed());
    } else {
        write_config(&config).context("failed to write nocta.config.json")?;
        created_paths.push(PathBuf::from("nocta.config.json"));
    }

    if manage_dependencies_here {
        if dry_run {
            pb.set_message(format!(
                "{}[dry-run] Checking required dependencies...",
                prefix
            ));
            println!("\n{}", "[dry-run] Would install dependencies:".blue());
            for (dep, version) in &required_dependencies {
                println!("   {}", format!("{}@{}", dep, version).dimmed());
            }
        } else {
            let install_map: HashMap<String, String> = required_dependencies
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            pb.set_message("Installing required dependencies...".to_string());
            if let Err(err) = install_dependencies(&install_map, &workspace.package_manager_context)
            {
                pb.suspend(|| {
                    println!(
                        "{}",
                        "Dependencies installation failed, but you can install them manually"
                            .yellow()
                    );
                    println!(
                        "{}",
                        format!(
                            "Run: npm install {}",
                            required_dependencies
                                .keys()
                                .cloned()
                                .collect::<Vec<_>>()
                                .join(" ")
                        )
                        .dimmed()
                    );
                    println!("{}", format!("Error: {}", err).red());
                });
            }
        }
    } else if dry_run {
        println!(
            "\n{}",
            "[dry-run] Would skip dependency installation in this workspace (managed via linked shared UI workspace)."
                .blue()
        );
    }

    let utils_path = PathBuf::from(format!("{}.ts", config.aliases.utils.filesystem_path()));
    let icons_path = resolve_component_path("components/icons.ts", &config);

    let (utils_created, icons_created) = if manage_dependencies_here {
        pb.set_message(format!("{}Creating utility functions...", prefix));
        let utils_created = ensure_registry_asset(
            client,
            dry_run,
            "lib/utils.ts",
            &utils_path,
            created_paths,
            "Utility functions",
        )?;

        pb.set_message(format!("{}Creating base icons component...", prefix));
        let icons_created = ensure_registry_asset(
            client,
            dry_run,
            "icons/icons.ts",
            &icons_path,
            created_paths,
            "Icons component",
        )?;
        (utils_created, icons_created)
    } else {
        pb.set_message(format!(
            "{}Skipping shared component helpers for linked workspace...",
            prefix
        ));
        pb.suspend(|| {
            println!(
                "{}",
                "Using shared UI workspace for component helpers; skipping local utils/icons creation."
                    .dimmed()
            );
        });
        (false, false)
    };

    let mut tokens_added = false;
    if manage_dependencies_here {
        pb.set_message(format!("{}Adding semantic color variables...", prefix));
        if dry_run {
            if !file_has_tokens(config.tailwind.css.as_str())? {
                tokens_added = true;
            }
        } else if add_design_tokens_to_css(client, config.tailwind.css.as_str())? {
            tokens_added = true;
        }
    } else {
        pb.set_message(format!(
            "{}Skipping design tokens for linked workspace...",
            prefix
        ));
        pb.suspend(|| {
            println!(
                "{}",
                "Design tokens expected from linked shared UI workspace; skipping local injection."
                    .dimmed()
            );
        });
    }

    if dry_run {
        // Manifest changes are reported in the summary during dry runs.
    } else {
        write_workspace_manifest(&workspace.repo_root, &workspace.manifest)
            .map_err(|err| anyhow!("failed to write {}: {}", WORKSPACE_MANIFEST_FILE, err))?;
        if !workspace.manifest_existed {
            created_paths.push(workspace.manifest_path.clone());
        }
    }

    pb.finish_with_message(format!(
        "{}nocta-ui {}",
        prefix,
        if dry_run {
            "would be initialized"
        } else {
            "initialized successfully!"
        }
    ));

    let framework_label = if framework_detection.framework == FrameworkKind::Unknown {
        format!(
            "Custom ({})",
            workspace_kind_label(workspace.config_workspace.kind)
        )
    } else {
        framework_info(&framework_detection)
    };

    print_init_summary(
        dry_run,
        &config,
        framework_label,
        &required_dependencies,
        !manage_dependencies_here,
        utils_created.then_some(utils_path.as_path()),
        icons_created.then_some(icons_path.as_path()),
        tokens_added,
        is_tailwind_v4,
        &workspace,
    );

    Ok(())
}

fn create_spinner(message: String) -> ProgressBar {
    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::with_template("{spinner:.blue} {msg}")
            .unwrap()
            .tick_chars("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"),
    );
    pb.enable_steady_tick(Duration::from_millis(80));
    pb.set_message(message);
    pb
}

fn print_tailwind_missing_message(check: &TailwindCheck) {
    let _ = check;
    println!("{}", "Tailwind CSS is required but not found!".red());
    println!(
        "{}",
        "Tailwind CSS is not installed or not found in node_modules".red()
    );
    println!("{}", "Please install Tailwind CSS first:".yellow());
    println!("{}", "   npm install -D tailwindcss".dimmed());
    println!("{}", "   # or".dimmed());
    println!("{}", "   yarn add -D tailwindcss".dimmed());
    println!("{}", "   # or".dimmed());
    println!("{}", "   pnpm add -D tailwindcss".dimmed());
    println!("{}", "   # or".dimmed());
    println!("{}", "   bun add -D tailwindcss".dimmed());
    println!(
        "{}",
        "Visit https://tailwindcss.com/docs/installation for setup guide".blue()
    );
}

fn print_framework_unknown_message(detection: &nocta_core::framework::FrameworkDetection) {
    println!("{}", "Unsupported project structure detected!".red());
    println!("{}", "Could not detect a supported React framework".red());
    println!("{}", "nocta-ui supports:".yellow());
    println!("{}", "   • Next.js (App Router or Pages Router)".dimmed());
    println!("{}", "   • Vite + React".dimmed());
    println!("{}", "   • React Router 7 (Framework Mode)".dimmed());
    println!("{}", "   • TanStack Start".dimmed());
    println!("{}", "Detection details:".blue());
    println!(
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
    );
    println!(
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
    );
    println!(
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
    );
    if !detection.details.has_react_dependency {
        println!("{}", "Install React first:".yellow());
        println!("{}", "   npm install react react-dom".dimmed());
        println!(
            "{}",
            "   npm install -D @types/react @types/react-dom".dimmed()
        );
    } else {
        println!("{}", "Set up a supported framework:".yellow());
        println!("{}", "   Next.js:".blue());
        println!("{}", "     npx create-next-app@latest".dimmed());
        println!("{}", "   Vite + React:".blue());
        println!(
            "{}",
            "     npm create vite@latest . -- --template react-ts".dimmed()
        );
        println!("{}", "   React Router 7:".blue());
        println!("{}", "     npx create-react-router@latest".dimmed());
        println!("{}", "   TanStack Start:".blue());
        println!("{}", "     npm create tanstack@latest".dimmed());
    }
}

fn print_requirement_issues(issues: &[RequirementIssue], dry_run: bool) {
    println!(
        "{}",
        "Project dependencies are missing or out of date.".yellow()
    );
    if dry_run {
        println!(
            "{}",
            "[dry-run] They would be installed automatically:".blue()
        );
    } else {
        println!("{}", "Installing required versions...".blue());
    }
    for issue in issues {
        println!(
            "{}",
            format!("   {}: requires {}", issue.name, issue.required).yellow()
        );
        if let Some(installed) = &issue.installed {
            println!("{}", format!("      installed: {}", installed).dimmed());
        } else {
            println!("{}", "      installed: not found".dimmed());
        }
        if let Some(declared) = &issue.declared {
            println!("{}", format!("      declared: {}", declared).dimmed());
        }
        match issue.reason {
            RequirementIssueReason::Outdated => {
                println!(
                    "{}",
                    "      will be updated to a compatible version".dimmed()
                );
            }
            RequirementIssueReason::Unknown => {
                println!(
                    "{}",
                    "      unable to determine installed version, forcing install".dimmed()
                );
            }
            RequirementIssueReason::Missing => {
                println!("{}", "      will be installed".dimmed());
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

fn print_tailwind_v4_required(check: &TailwindCheck) {
    println!("{}", "Tailwind CSS v4 is required".red());
    println!(
        "{}",
        format!(
            "Detected Tailwind version that is not v4: {}",
            check.version.clone().unwrap_or_else(|| "unknown".into())
        )
        .red()
    );
    println!("{}", "Please upgrade to Tailwind CSS v4:".yellow());
    println!("{}", "   npm install -D tailwindcss@latest".dimmed());
    println!("{}", "   # or".dimmed());
    println!("{}", "   yarn add -D tailwindcss@latest".dimmed());
    println!("{}", "   # or".dimmed());
    println!("{}", "   pnpm add -D tailwindcss@latest".dimmed());
    println!("{}", "   # or".dimmed());
    println!("{}", "   bun add -D tailwindcss@latest".dimmed());
}

fn ensure_registry_asset(
    client: &RegistryClient,
    dry_run: bool,
    asset_path: &str,
    target_path: &Path,
    created_paths: &mut Vec<PathBuf>,
    label: &str,
) -> Result<bool> {
    if file_exists(target_path) {
        println!(
            "{}",
            format!(
                "{} already exists - skipping creation",
                target_path.display()
            )
            .yellow()
        );
        return Ok(false);
    }

    if dry_run {
        println!("{}", format!("[dry-run] Would create {}:", label).blue());
        println!("   {}", target_path.display().to_string().dimmed());
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

fn file_has_tokens(path: &str) -> Result<bool> {
    if !file_exists(path) {
        return Ok(false);
    }
    let contents =
        std::fs::read_to_string(path).with_context(|| format!("failed to read {}", path))?;
    Ok(contents.contains("NOCTA CSS THEME VARIABLES"))
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
        workspace: None,
    })
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
    println!("{}", "\nConfiguration created:".green());
    println!(
        "{}",
        format!("   nocta.config.json ({})", framework_info).dimmed()
    );
    println!(
        "{}",
        format!(
            "   Workspace: {} (root: {})",
            workspace_kind_label(workspace.config_workspace.kind),
            workspace.workspace_root_str
        )
        .dimmed()
    );
    println!(
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
    );
    if let Some(package) = workspace.config_workspace.package_name.as_deref() {
        println!("{}", format!("   Package: {}", package).dimmed());
    }

    if !workspace.config_workspace.linked_workspaces.is_empty() {
        println!("{}", "\nLinked workspaces:".blue());
        for link in &workspace.config_workspace.linked_workspaces {
            let label = link.package_name.as_deref().unwrap_or(&link.root);
            println!("   {}", format!("{} ({})", label, link.config).dimmed());
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
    println!(
        "{}",
        format!("   Manifest: {} ({})", manifest_display, manifest_action).dimmed()
    );

    if dependencies_managed_elsewhere {
        println!(
            "\n{}",
            "Dependencies managed via linked shared UI workspace(s).".blue()
        );
        if !dependencies.is_empty() {
            println!("{}", "   Ensure the linked workspace includes:".dimmed());
            for (dep, version) in dependencies {
                println!("   {}", format!("{}@{}", dep, version).dimmed());
            }
        }
    } else {
        let dep_heading = if dry_run {
            "[dry-run] Would install dependencies:".blue()
        } else {
            "Dependencies installed:".blue()
        };
        println!("\n{}", dep_heading);
        for (dep, version) in dependencies {
            println!("   {}", format!("{}@{}", dep, version).dimmed());
        }
    }

    if let Some(path) = utils_path {
        println!("\n{}", "Utility functions created:".green());
        println!("   {}", path.display().to_string().dimmed());
        println!("   {}", "• cn() function for className merging".dimmed());
    }

    if let Some(path) = icons_path {
        println!("\n{}", "Icons component created:".green());
        println!("   {}", path.display().to_string().dimmed());
        println!("   {}", "• Base Radix Icons mapping".dimmed());
    }

    match (tokens_added, dependencies_managed_elsewhere) {
        (true, _) => {
            let heading = if dry_run {
                "[dry-run] Would add color variables:".green()
            } else {
                "Color variables added:".green()
            };
            println!("\n{}", heading);
            println!("   {}", config.tailwind.css.as_str().dimmed());
            println!(
                "   {}",
                "• Semantic tokens (background, foreground, primary, border, etc.)".dimmed()
            );
        }
        (false, true) => {
            println!(
                "\n{}",
                "Design tokens managed in linked shared UI workspace.".blue()
            );
        }
        (false, false) => {
            println!(
                "\n{}",
                "Design tokens skipped (already exist or error occurred)".yellow()
            );
        }
    }

    if tailwind_is_v4 {
        println!("\n{}", "Tailwind v4 detected!".blue());
        println!(
            "{}",
            "   Make sure your CSS file includes @import \"tailwindcss\";".dimmed()
        );
    }

    let final_heading = if dry_run {
        "[dry-run] You could then add components:".blue()
    } else {
        "You can now add components:".blue()
    };
    println!("\n{}", final_heading);
    println!("   {}", "npx nocta-ui add button".dimmed());
}
