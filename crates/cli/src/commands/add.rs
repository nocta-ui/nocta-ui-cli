use std::collections::{BTreeMap, HashMap, HashSet};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow};
use clap::Args;
use dialoguer::Confirm;
use indicatif::ProgressBar;
use once_cell::sync::Lazy;
use owo_colors::OwoColorize;
use pathdiff::diff_paths;
use regex::Regex;

use crate::commands::{CommandOutcome, CommandResult};
use crate::reporter::ConsoleReporter;
use crate::util::{canonicalize_path, create_spinner, normalize_relative_path};
use nocta_core::config::{read_config, read_config_from};
use nocta_core::deps::{
    plan_dependency_install, RequirementIssueReason, check_project_requirements,
    get_installed_dependencies_at,
};
use nocta_core::framework::{FrameworkDetection, FrameworkKind, detect_framework};
use nocta_core::fs::{file_exists, write_file};
use nocta_core::paths::resolve_component_path;
use nocta_core::registry::RegistryClient;
use nocta_core::rollback::rollback_changes;
use nocta_core::workspace::{
    PackageManagerContext, PackageManagerKind, detect_package_manager, find_repo_root,
    load_workspace_manifest,
};

use nocta_core::types::{Component, Config, WorkspaceKind};

#[derive(Args, Debug, Clone)]
pub struct AddArgs {
    #[arg(value_name = "components", required = true)]
    pub components: Vec<String>,
    #[arg(long = "dry-run")]
    pub dry_run: bool,
}

static IMPORT_NORMALIZE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(['"])@/([^'"\n]+)(['"])"#).expect("valid import normalization regex")
});

struct AddCommand<'a> {
    client: &'a RegistryClient,
    reporter: &'a ConsoleReporter,
    args: AddArgs,
    dry_run: bool,
    prefix: String,
    spinner: ProgressBar,
    written_paths: Vec<PathBuf>,
}

impl<'a> AddCommand<'a> {
    fn new(client: &'a RegistryClient, reporter: &'a ConsoleReporter, args: AddArgs) -> Self {
        let dry_run = args.dry_run;
        let prefix = if dry_run {
            "[dry-run] ".to_string()
        } else {
            String::new()
        };
        let label = if args.components.len() > 1 {
            format!("{}Adding {} components...", prefix, args.components.len())
        } else {
            format!(
                "{}Adding {}...",
                prefix,
                args.components
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "component".into())
            )
        };
        let spinner = create_spinner(label);
        Self {
            client,
            reporter,
            args,
            dry_run,
            prefix,
            spinner,
            written_paths: Vec::new(),
        }
    }

    fn execute(&mut self) -> CommandResult {
        let config = match self.load_config()? {
            Some(config) => config,
            None => return Ok(CommandOutcome::NoOp),
        };

        self.spinner
            .set_message(format!("{}Detecting framework...", self.prefix));
        let framework_detection = detect_framework();
        let workspace_context = self.build_workspace_context(&config, &framework_detection)?;

        self.spinner.set_message(format!(
            "{}Fetching components and dependencies...",
            self.prefix
        ));
        let lookup = self.fetch_component_lookup()?;
        let requested_slugs = match self.resolve_requested_components(&lookup)? {
            Some(slugs) => slugs,
            None => {
                self.finish();
                return Ok(CommandOutcome::NoOp);
            }
        };
        let component_entries = collect_components(self.client, &requested_slugs)?;
        let requested_entries: Vec<_> = component_entries
            .iter()
            .filter(|entry| requested_slugs.contains(&entry.slug))
            .cloned()
            .collect();
        let dependency_entries: Vec<_> = component_entries
            .iter()
            .filter(|entry| !requested_slugs.contains(&entry.slug))
            .cloned()
            .collect();

        self.spinner.finish_and_clear();
        self.print_component_plan(&requested_entries, &dependency_entries);

        let mut prep_spinner = create_spinner(if self.dry_run {
            "[dry-run] Preparing components..."
        } else {
            "Preparing components..."
        });

        let (all_component_files, deps_by_workspace) =
            gather_component_files(self.client, &component_entries, &workspace_context)?;

        prep_spinner.set_message("Checking existing files...");
        let existing_files = find_existing_files(&all_component_files);

        if !existing_files.is_empty() {
            prep_spinner.finish_and_clear();
            if !self.handle_existing_files(&existing_files, &all_component_files)? {
                return Ok(CommandOutcome::NoOp);
            }
        } else {
            self.write_component_files(&mut prep_spinner, &all_component_files)?;
            prep_spinner.finish_and_clear();
        }

        if deps_by_workspace.values().any(|deps| !deps.is_empty()) {
            handle_workspace_dependencies(
                self.dry_run,
                &workspace_context,
                &deps_by_workspace,
                self.reporter,
            )?;
        }

        let final_spinner = create_spinner(format!(
            "{}{}",
            self.prefix,
            if self.args.components.len() > 1 {
                format!("{} components", self.args.components.len())
            } else {
                self.args.components[0].clone()
            }
        ));
        final_spinner.finish_with_message(format!(
            "{}{} {}",
            self.prefix,
            if self.args.components.len() > 1 {
                format!("{} components", self.args.components.len())
            } else {
                self.args.components[0].clone()
            },
            if self.dry_run {
                "would be added"
            } else {
                "added successfully!"
            }
        ));

        print_add_summary(
            self.reporter,
            self.dry_run,
            &workspace_context,
            &requested_entries,
            &all_component_files,
        );

        Ok(CommandOutcome::Completed)
    }

    fn load_config(&mut self) -> Result<Option<Config>> {
        match read_config()? {
            Some(config) => Ok(Some(config)),
            None => {
                self.spinner.finish_and_clear();
                self.reporter
                    .error(format!("{}", "nocta.config.json not found".red()));
                self.reporter
                    .warn(format!("{}", "Run \"npx nocta-ui init\" first".yellow()));
                Ok(None)
            }
        }
    }

    fn build_workspace_context(
        &self,
        config: &Config,
        detection: &FrameworkDetection,
    ) -> Result<WorkspaceContext> {
        build_workspace_context(config, detection)
    }

    fn fetch_component_lookup(&self) -> Result<HashMap<String, String>> {
        let registry = self.client.fetch_registry()?;
        Ok(build_component_lookup(&registry.components))
    }

    fn resolve_requested_components(
        &mut self,
        lookup: &HashMap<String, String>,
    ) -> Result<Option<Vec<String>>> {
        let mut slugs = Vec::new();
        for name in &self.args.components {
            match lookup.get(&name.to_lowercase()) {
                Some(slug) => slugs.push(slug.clone()),
                None => {
                    self.spinner.finish_and_clear();
                    self.reporter.error(format!(
                        "{}",
                        format!("Component \"{}\" not found", name).red()
                    ));
                    self.reporter.warn(format!(
                        "{}",
                        "Run \"npx nocta-ui list\" to see available components".yellow()
                    ));
                    return Ok(None);
                }
            }
        }
        Ok(Some(slugs))
    }

    fn print_component_plan(
        &self,
        requested_entries: &[ComponentEntry],
        dependency_entries: &[ComponentEntry],
    ) {
        self.reporter.info(format!(
            "{}",
            format!(
                "Installing {}:",
                if self.args.components.len() > 1 {
                    format!("{} components", self.args.components.len())
                } else {
                    self.args.components[0].clone()
                }
            )
            .blue()
        ));

        for entry in requested_entries {
            self.reporter.info(format!(
                "   {}",
                format!("• {} (requested)", entry.component.name).green()
            ));
        }

        if !dependency_entries.is_empty() {
            self.reporter
                .info(format!("{}", "\nWith internal dependencies:".blue()));
            for entry in dependency_entries {
                self.reporter.info(format!(
                    "   {}",
                    format!("• {}", entry.component.name).dimmed()
                ));
            }
        }

        self.reporter.blank();
    }

    fn handle_existing_files(
        &mut self,
        existing_files: &[PathBuf],
        component_files: &[ComponentFileWithContent],
    ) -> Result<bool> {
        self.reporter
            .warn(format!("{}", "The following files already exist:".yellow()));
        for path in existing_files {
            self.reporter
                .info(format!("   {}", path.display().to_string().dimmed()));
        }

        if self.dry_run {
            self.reporter
                .info(format!("\n{}", "[dry-run] Would overwrite the files above".blue()));
            self.reporter.blank();
            let spinner = create_spinner("[dry-run] Preparing file writes...");
            write_component_files(component_files, true, &mut self.written_paths)?;
            spinner.finish_and_clear();
            Ok(true)
        } else {
            let overwrite = Confirm::new()
                .with_prompt("Do you want to overwrite these files?")
                .default(false)
                .interact()?;

            if !overwrite {
                self.reporter
                    .warn(format!("{}", "Installation cancelled".red()));
                return Ok(false);
            }

            let spinner = create_spinner("Installing component files...");
            write_component_files(component_files, false, &mut self.written_paths)?;
            spinner.finish_and_clear();
            Ok(true)
        }
    }

    fn write_component_files(
        &mut self,
        spinner: &mut ProgressBar,
        component_files: &[ComponentFileWithContent],
    ) -> Result<()> {
        if self.dry_run {
            spinner.set_message("[dry-run] Preparing file writes...");
        } else {
            spinner.set_message("Installing component files...");
        }
        write_component_files(component_files, self.dry_run, &mut self.written_paths)?;
        Ok(())
    }

    fn finish(&mut self) {
        self.spinner.finish_and_clear();
    }

    fn rollback(&self) {
        if !self.dry_run && !self.written_paths.is_empty() {
            let _ = rollback_changes(&self.written_paths);
            self.reporter
                .warn(format!("{}", "Rolled back written component files".yellow()));
        }
    }
}

pub fn run(
    client: &RegistryClient,
    reporter: &ConsoleReporter,
    args: AddArgs,
) -> CommandResult {
    let mut command = AddCommand::new(client, reporter, args);
    match command.execute() {
        Ok(outcome) => Ok(outcome),
        Err(err) => {
            command.finish();
            command.rollback();
            Err(err)
        }
    }
}

#[derive(Clone)]
struct ComponentEntry {
    slug: String,
    component: Component,
}

#[derive(Clone)]
struct WorkspaceHandle {
    id: String,
    label: String,
    kind: WorkspaceKind,
    root_abs: PathBuf,
    root_rel: String,
    config: Config,
    alias_prefix: String,
    component_import_alias: Option<String>,
    package_name: Option<String>,
    package_manager_context: PackageManagerContext,
}

struct WorkspaceContext {
    current_dir: PathBuf,
    handles: Vec<WorkspaceHandle>,
}

impl WorkspaceContext {
    fn primary(&self) -> &WorkspaceHandle {
        self.handles
            .first()
            .expect("workspace context should have at least one handle")
    }

    fn handles(&self) -> impl Iterator<Item = &WorkspaceHandle> {
        self.handles.iter()
    }

    fn handle_by_id(&self, id: &str) -> Option<&WorkspaceHandle> {
        self.handles.iter().find(|handle| handle.id == id)
    }

    fn first_by_kind(&self, kind: WorkspaceKind) -> Option<&WorkspaceHandle> {
        self.handles.iter().find(|handle| handle.kind == kind)
    }
}

#[derive(Clone)]
struct ComponentFileWithContent {
    workspace_id: String,
    absolute_path: PathBuf,
    display_path: PathBuf,
    content: String,
    component_name: String,
}

fn resolve_alias_prefix(config: &Config, detection: Option<&FrameworkDetection>) -> String {
    if let Some(prefixes) = config.alias_prefixes.as_ref() {
        if let Some(prefix) = prefixes.components.as_ref() {
            return prefix.clone();
        }
    }

    if let Some(details) = detection {
        if details.framework == FrameworkKind::ReactRouter {
            return "~".into();
        }
    }

    "@".into()
}

fn resolve_component_import_alias(config: &Config) -> Option<String> {
    config
        .aliases
        .components
        .import_alias()
        .map(|alias| alias.trim_end_matches('/').to_string())
}

fn build_workspace_context(
    config: &Config,
    detection: &FrameworkDetection,
) -> Result<WorkspaceContext> {
    let current_dir = canonicalize_path(&std::env::current_dir()?);
    let repo_root_candidate = find_repo_root(&current_dir).unwrap_or(current_dir.clone());
    let repo_root = canonicalize_path(&repo_root_candidate);

    let manifest = load_workspace_manifest(&repo_root)
        .map_err(|err| anyhow!("failed to read workspace manifest: {}", err))?
        .unwrap_or_default();
    let package_manager = manifest
        .package_manager
        .or_else(|| detect_package_manager(&repo_root))
        .unwrap_or(PackageManagerKind::Npm);

    let mut handles = Vec::new();

    if let Some(workspace_cfg) = config.workspace.as_ref() {
        let root_rel = if workspace_cfg.root.is_empty() {
            ".".into()
        } else {
            workspace_cfg.root.clone()
        };
        let root_abs = canonicalize_path(&repo_root.join(Path::new(&workspace_cfg.root)));

        let alias_prefix = resolve_alias_prefix(config, Some(detection));
        let component_import_alias = resolve_component_import_alias(config);
        let mut pm_context = PackageManagerContext::new(repo_root.clone());
        pm_context.package_manager = Some(package_manager);
        pm_context.workspace_root = Some(root_abs.clone());
        if let Some(pkg) = workspace_cfg.package_name.as_ref() {
            pm_context.workspace_package = Some(pkg.clone());
        }

        handles.push(WorkspaceHandle {
            id: "primary".into(),
            label: workspace_cfg
                .package_name
                .clone()
                .unwrap_or_else(|| root_rel.clone()),
            kind: workspace_cfg.kind,
            root_abs: root_abs.clone(),
            root_rel: root_rel.clone(),
            config: config.clone(),
            alias_prefix,
            component_import_alias,
            package_name: workspace_cfg.package_name.clone(),
            package_manager_context: pm_context,
        });

        let current_root_abs = root_abs;
        for (index, link) in workspace_cfg.linked_workspaces.iter().enumerate() {
            let link_root_abs = canonicalize_path(&repo_root.join(Path::new(&link.root)));
            let link_config_path =
                canonicalize_path(&current_root_abs.join(Path::new(&link.config)));
            let link_config = read_config_from(&link_config_path)
                .map_err(|err| {
                    anyhow!(
                        "failed to read linked workspace config {}: {}",
                        link.config,
                        err
                    )
                })?
                .ok_or_else(|| {
                    anyhow!(
                        "linked workspace config {} not found (expected for {})",
                        link.config,
                        link.root
                    )
                })?;

            let alias_prefix = resolve_alias_prefix(&link_config, None);
            let component_import_alias = resolve_component_import_alias(&link_config);
            let mut pm_context = PackageManagerContext::new(repo_root.clone());
            pm_context.package_manager = Some(package_manager);
            pm_context.workspace_root = Some(link_root_abs.clone());
            if let Some(pkg) = link.package_name.as_ref() {
                pm_context.workspace_package = Some(pkg.clone());
            }

            handles.push(WorkspaceHandle {
                id: format!("linked-{}", index),
                label: link
                    .package_name
                    .clone()
                    .unwrap_or_else(|| link.root.clone()),
                kind: link.kind,
                root_abs: link_root_abs,
                root_rel: link.root.clone(),
                config: link_config,
                alias_prefix,
                component_import_alias,
                package_name: link.package_name.clone(),
                package_manager_context: pm_context,
            });
        }
    } else {
        let alias_prefix = resolve_alias_prefix(config, Some(detection));
        let component_import_alias = resolve_component_import_alias(config);
        let mut pm_context = PackageManagerContext::new(repo_root.clone());
        pm_context.package_manager = Some(package_manager);
        pm_context.workspace_root = Some(current_dir.clone());

        handles.push(WorkspaceHandle {
            id: "primary".into(),
            label: config
                .workspace
                .as_ref()
                .and_then(|ws| ws.package_name.clone())
                .unwrap_or_else(|| ".".into()),
            kind: WorkspaceKind::App,
            root_abs: current_dir.clone(),
            root_rel: normalize_relative_path(Path::new(".")),
            config: config.clone(),
            alias_prefix,
            component_import_alias,
            package_name: config
                .workspace
                .as_ref()
                .and_then(|ws| ws.package_name.clone()),
            package_manager_context: pm_context,
        });
    }

    Ok(WorkspaceContext {
        current_dir,
        handles,
    })
}

fn select_workspace_handle<'a>(
    context: &'a WorkspaceContext,
    target: Option<&str>,
) -> Result<&'a WorkspaceHandle> {
    if let Some(target) = target {
        let normalized = target.to_ascii_lowercase();

        if let Some(handle) = context.handles().find(|handle| {
            handle
                .package_name
                .as_ref()
                .map(|pkg| pkg.to_ascii_lowercase())
                == Some(normalized.clone())
        }) {
            return Ok(handle);
        }

        if let Some(handle) = context
            .handles()
            .find(|handle| handle.root_rel.to_ascii_lowercase() == normalized)
        {
            return Ok(handle);
        }

        let by_kind = match normalized.as_str() {
            "app" => context.first_by_kind(WorkspaceKind::App),
            "ui" | "shared" => context.first_by_kind(WorkspaceKind::Ui),
            "library" | "lib" => context.first_by_kind(WorkspaceKind::Library),
            _ => None,
        };

        if let Some(handle) = by_kind {
            return Ok(handle);
        }

        anyhow::bail!(
            "No workspace configured for target `{}`. Update nocta.config.json to link the workspace.",
            target
        );
    }

    if context.primary().kind == WorkspaceKind::App {
        if let Some(ui_handle) = context.first_by_kind(WorkspaceKind::Ui) {
            return Ok(ui_handle);
        }
    }

    Ok(context.primary())
}

fn build_component_lookup(components: &HashMap<String, Component>) -> HashMap<String, String> {
    let mut lookup = HashMap::new();
    for (slug, component) in components {
        lookup.insert(slug.to_lowercase(), slug.clone());
        lookup.insert(component.name.to_lowercase(), slug.clone());
    }
    lookup
}

fn collect_components(
    client: &RegistryClient,
    requested_slugs: &[String],
) -> Result<Vec<ComponentEntry>> {
    let mut seen = HashSet::new();
    let mut entries = Vec::new();

    for slug in requested_slugs {
        let components = client.fetch_component_with_dependencies(slug)?;
        for component in components {
            if let Some(component_slug) = component_slug(&component) {
                if seen.insert(component_slug.clone()) {
                    entries.push(ComponentEntry {
                        slug: component_slug,
                        component,
                    });
                }
            }
        }
    }

    Ok(entries)
}

fn component_slug(component: &Component) -> Option<String> {
    component.files.first().and_then(|file| {
        Path::new(&file.path)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .map(|s| s.to_lowercase())
    })
}

fn gather_component_files(
    client: &RegistryClient,
    components: &[ComponentEntry],
    context: &WorkspaceContext,
) -> Result<(
    Vec<ComponentFileWithContent>,
    HashMap<String, BTreeMap<String, String>>,
)> {
    let mut files = Vec::new();
    let mut deps_per_workspace: HashMap<String, BTreeMap<String, String>> = HashMap::new();

    for entry in components {
        let mut workspace_ids_for_component = HashSet::new();

        for file in &entry.component.files {
            let handle = select_workspace_handle(context, file.target.as_deref())?;
            let contents = client
                .fetch_component_file(&file.path)
                .with_context(|| format!("failed to fetch component asset {}", file.path))?;
            let normalized = normalize_component_content(&contents, handle);
            let mut relative_path = resolve_component_path(&file.path, &handle.config);

            if let Some(flattened) =
                flatten_relative_path_for_slug(&relative_path, &handle.config, &entry.slug)
            {
                relative_path = flattened;
            }

            let absolute_path = handle.root_abs.join(&relative_path);
            let display_path = diff_paths(&absolute_path, &context.current_dir)
                .unwrap_or_else(|| absolute_path.clone());

            files.push(ComponentFileWithContent {
                workspace_id: handle.id.clone(),
                absolute_path,
                display_path,
                content: normalized,
                component_name: entry.component.name.clone(),
            });

            workspace_ids_for_component.insert(handle.id.clone());
        }

        let preferred_target = select_dependency_target(&workspace_ids_for_component, context)?;

        if let Some(target_id) = preferred_target {
            let deps_entry = deps_per_workspace
                .entry(target_id.clone())
                .or_insert_with(BTreeMap::new);
            for (name, version) in &entry.component.dependencies {
                deps_entry.entry(name.clone()).or_insert(version.clone());
            }
        }
    }

    Ok((files, deps_per_workspace))
}

fn flatten_relative_path_for_slug(
    relative_path: &Path,
    config: &Config,
    slug: &str,
) -> Option<PathBuf> {
    let base = Path::new(config.aliases.components.filesystem_path());
    let stripped = relative_path.strip_prefix(base).ok()?;
    let mut components = stripped.components();
    let first = components.next()?;

    if first.as_os_str() != OsStr::new(slug) {
        return None;
    }

    let remainder: PathBuf = components.collect();
    if remainder.as_os_str().is_empty() {
        return None;
    }

    Some(base.join(remainder))
}

fn select_dependency_target(
    workspace_ids: &HashSet<String>,
    context: &WorkspaceContext,
) -> Result<Option<String>> {
    if workspace_ids.is_empty() {
        return Ok(None);
    }

    // Prefer UI workspaces
    if let Some(id) = workspace_ids.iter().find(|id| {
        context
            .handle_by_id(id)
            .map(|handle| handle.kind == WorkspaceKind::Ui)
            .unwrap_or(false)
    }) {
        return Ok(Some(id.clone()));
    }

    // Next, prefer Library workspaces
    if let Some(id) = workspace_ids.iter().find(|id| {
        context
            .handle_by_id(id)
            .map(|handle| handle.kind == WorkspaceKind::Library)
            .unwrap_or(false)
    }) {
        return Ok(Some(id.clone()));
    }

    // Fall back to the first workspace (typically the app) when no better target exists
    if let Some(id) = workspace_ids.iter().next() {
        return Ok(Some(id.clone()));
    }

    Ok(None)
}

fn normalize_component_content(content: &str, handle: &WorkspaceHandle) -> String {
    let alias_prefix = handle.alias_prefix.trim_end_matches('/');
    let component_alias = handle
        .component_import_alias
        .as_deref()
        .map(|alias| alias.trim_end_matches('/').to_string());

    IMPORT_NORMALIZE_RE
        .replace_all(content, |caps: &regex::Captures| {
            let open = &caps[1];
            let path = normalize_import_path(&caps[2]);
            let close = &caps[3];

            if let Some(custom_alias) = component_alias.as_deref() {
                if let Some(relative) = component_relative_path(handle, &path) {
                    let joined = if relative.is_empty() {
                        custom_alias.to_string()
                    } else {
                        join_import_path(custom_alias, &relative)
                    };
                    return format!("{}{}{}", open, joined, close);
                }
            }

            format!("{}{}{}", open, join_import_path(alias_prefix, &path), close)
        })
        .into_owned()
}

fn normalize_import_path(import_path: &str) -> String {
    let mut path = import_path
        .trim_start_matches("./")
        .trim_start_matches("/")
        .to_string();
    if let Some(stripped) = path.strip_prefix("app/") {
        path = stripped.to_string();
    } else if let Some(stripped) = path.strip_prefix("src/") {
        path = stripped.to_string();
    }
    path
}

fn join_import_path(prefix: &str, import_path: &str) -> String {
    let sanitized_prefix = prefix.trim_end_matches('/');
    if import_path.is_empty() {
        sanitized_prefix.to_string()
    } else {
        format!(
            "{}/{}",
            sanitized_prefix,
            import_path.trim_start_matches('/')
        )
    }
}

fn find_existing_files(files: &[ComponentFileWithContent]) -> Vec<PathBuf> {
    files
        .iter()
        .filter(|file| file_exists(&file.absolute_path))
        .map(|file| file.display_path.clone())
        .collect()
}

fn write_component_files(
    files: &[ComponentFileWithContent],
    dry_run: bool,
    written_paths: &mut Vec<PathBuf>,
) -> Result<()> {
    for file in files {
        if dry_run {
            continue;
        }
        write_file(&file.absolute_path, &file.content)
            .with_context(|| format!("failed to write {}", file.display_path.display()))?;
        written_paths.push(file.absolute_path.clone());
    }
    Ok(())
}

fn handle_workspace_dependencies(
    dry_run: bool,
    context: &WorkspaceContext,
    deps_by_workspace: &HashMap<String, BTreeMap<String, String>>,
    reporter: &ConsoleReporter,
) -> Result<()> {
    for handle in context.handles() {
        let required = match deps_by_workspace.get(&handle.id) {
            Some(map) if !map.is_empty() => map,
            _ => continue,
        };

        let base_path = handle
            .package_manager_context
            .workspace_root
            .as_ref()
            .map(|path| path.as_path())
            .unwrap_or_else(|| handle.root_abs.as_path());

        let installed = get_installed_dependencies_at(base_path)?;
        let required_map: HashMap<String, String> = required
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        let issues = check_project_requirements(base_path, &required_map)?;

        let mut deps_to_install = BTreeMap::new();
        let mut incompatible = Vec::new();
        let mut satisfied = Vec::new();

        for (dep, version) in required {
            if let Some(issue) = issues.iter().find(|issue| issue.name == *dep) {
                deps_to_install.insert(dep.clone(), version.clone());
                let detail = match issue.reason {
                    RequirementIssueReason::Missing => {
                        format!("{}: required {}", dep, version)
                    }
                    RequirementIssueReason::Outdated | RequirementIssueReason::Unknown => {
                        format!(
                            "{}: installed {}, required {}",
                            dep,
                            issue.installed.clone().unwrap_or_else(|| "unknown".into()),
                            version
                        )
                    }
                };
                incompatible.push(detail);
            } else if let Some(installed_version) = installed.get(dep) {
                satisfied.push(format!(
                    "{}@{} (satisfies {})",
                    dep, installed_version, version
                ));
            }
        }

        if !satisfied.is_empty() {
            let satisfied_heading = format!("Dependencies already satisfied in {}:", handle.label);
            reporter.info(format!("\n{}", satisfied_heading.green()));
            for entry in satisfied {
                reporter.info(format!("   {}", entry.dimmed()));
            }
        }

        if !incompatible.is_empty() {
            let incompatible_heading = if dry_run {
                format!(
                    "[dry-run] Would update incompatible dependencies in {}:",
                    handle.label
                )
            } else {
                format!("Incompatible dependencies updated in {}:", handle.label)
            };
            reporter.warn(format!("\n{}", incompatible_heading.yellow()));
            for entry in &incompatible {
                reporter.info(format!("   {}", entry.dimmed()));
            }
        }

        if !deps_to_install.is_empty() {
            let install_heading = if dry_run {
                format!("[dry-run] Would install dependencies in {}:", handle.label)
            } else {
                format!("Installing missing dependencies in {}...", handle.label)
            };
            reporter.info(format!("\n{}", install_heading.blue()));
            for (dep, version) in &deps_to_install {
                reporter.info(format!("   {}", format!("{}@{}", dep, version).dimmed()));
            }

            let install_map: HashMap<String, String> = deps_to_install
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();

            if dry_run {
                if let Some(plan) =
                    plan_dependency_install(&install_map, &handle.package_manager_context)?
                {
                    reporter.info(format!(
                        "{}",
                        format!("   Command: {}", plan.command_line().join(" ")).dimmed()
                    ));
                }
            } else if let Some(plan) =
                plan_dependency_install(&install_map, &handle.package_manager_context)?
            {
                plan.execute()?;
                reporter.info(format!(
                    "{}",
                    format!("Dependencies installed for {}.", handle.label).green()
                ));
            }
        }
    }

    Ok(())
}

fn print_add_summary(
    reporter: &ConsoleReporter,
    dry_run: bool,
    context: &WorkspaceContext,
    requested_components: &[ComponentEntry],
    files: &[ComponentFileWithContent],
) {
    reporter.blank();
    reporter
        .info(format!("{}", "Components installed:".green()));

    let mut files_by_workspace: BTreeMap<String, Vec<&ComponentFileWithContent>> = BTreeMap::new();
    for file in files {
        files_by_workspace
            .entry(file.workspace_id.clone())
            .or_default()
            .push(file);
    }

    for (workspace_id, entries) in &files_by_workspace {
        if let Some(handle) = context.handle_by_id(workspace_id) {
            reporter.info(format!("{}", format!("  Workspace {}:", handle.label).blue()));
            for file in entries {
                reporter.info(format!(
                    "     {}",
                    format!("{} ({})", file.display_path.display(), file.component_name)
                        .dimmed()
                ));
            }
        }
    }

    let heading = if dry_run {
        "[dry-run] Example imports:".blue()
    } else {
        "Import and use:".blue()
    };
    reporter.info(format!("\n{}", heading));

    let primary_handle =
        select_workspace_handle(context, None).unwrap_or_else(|_| context.primary());
    let alias_base = component_import_base(primary_handle);

    for component in requested_components {
        if let Some(first_file) = component.component.files.first() {
            let mut raw_path = first_file
                .path
                .trim_start_matches("./")
                .trim_start_matches('/')
                .to_string();
            if let Some(stripped) = raw_path.strip_suffix(".tsx") {
                raw_path = stripped.to_string();
            }
            let relative_path = component_relative_path(primary_handle, &raw_path)
                .unwrap_or_else(|| raw_path.clone());

            reporter.info(format!(
                "   {}",
                format!(
                    "import {{ {} }} from \"{}\"; // {}",
                    component.component.exports.join(", "),
                    if relative_path.is_empty() {
                        alias_base.clone()
                    } else {
                        join_import_path(&alias_base, &relative_path)
                    },
                    component.component.name
                )
                .dimmed()
            ));
        }
    }

    let variants: Vec<_> = requested_components
        .iter()
        .filter(|entry| !entry.component.variants.is_empty())
        .collect();
    if !variants.is_empty() {
        reporter.info(format!("\n{}", "Available variants:".blue()));
        for entry in variants {
            reporter.info(format!(
                "   {}",
                format!(
                    "{}: {}",
                    entry.component.name,
                    entry.component.variants.join(", ")
                )
                .dimmed()
            ));
        }
    }

    let sizes: Vec<_> = requested_components
        .iter()
        .filter(|entry| !entry.component.sizes.is_empty())
        .collect();
    if !sizes.is_empty() {
        reporter.info(format!("\n{}", "Available sizes:".blue()));
        for entry in sizes {
            reporter.info(format!(
                "   {}",
                format!(
                    "{}: {}",
                    entry.component.name,
                    entry.component.sizes.join(", ")
                )
                .dimmed()
            ));
        }
    }
}

fn normalize_alias_path(path: &str) -> String {
    path.trim_start_matches("./")
        .trim_start_matches('/')
        .trim_start_matches("src/")
        .trim_start_matches("app/")
        .to_string()
}

fn component_import_base(handle: &WorkspaceHandle) -> String {
    if let Some(custom_alias) = handle.component_import_alias.as_deref() {
        custom_alias.trim_end_matches('/').to_string()
    } else {
        let normalized = normalize_alias_path(handle.config.aliases.components.filesystem_path());
        let prefix = handle.alias_prefix.trim_end_matches('/');

        if normalized.is_empty() {
            prefix.to_string()
        } else {
            join_import_path(prefix, &normalized)
        }
    }
}

fn component_relative_path(handle: &WorkspaceHandle, path: &str) -> Option<String> {
    let normalized = path.trim_start_matches("./").trim_start_matches('/');

    if normalized == "components" {
        return Some(String::new());
    }

    let stripped = match normalized.strip_prefix("components/") {
        Some(value) => value,
        None => return None,
    };

    let alias_suffix = normalize_alias_path(handle.config.aliases.components.filesystem_path());
    let suffix = alias_suffix
        .trim_start_matches("components/")
        .trim_start_matches('/');

    let mut relative = stripped;
    if !suffix.is_empty() {
        if let Some(after_suffix) = relative.strip_prefix(suffix) {
            relative = after_suffix.trim_start_matches('/');
        }
    }

    Some(relative.to_string())
}
