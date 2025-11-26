use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow};
use clap::Args;
use dialoguer::Confirm;
use futures::stream::{self, StreamExt};
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
    DependencyScope, RequirementIssueReason, check_project_requirements,
    get_installed_dependencies_at, plan_dependency_install,
};
use nocta_core::framework::{FrameworkDetection, FrameworkKind, detect_framework};
use nocta_core::fs::{file_exists, read_file, write_file};
use nocta_core::paths::resolve_component_path;
use nocta_core::registry::RegistryClient;
use nocta_core::workspace::{
    PackageManagerContext, PackageManagerKind, detect_package_manager, find_repo_root,
    load_workspace_manifest,
};

use nocta_core::types::{Component, Config, ExportStrategy, WorkspaceKind};

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
    written_files: Vec<FileChange>,
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
            written_files: Vec::new(),
        }
    }

    async fn execute(&mut self) -> CommandResult {
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
        let lookup = self.fetch_component_lookup().await?;
        let requested_slugs = match self.resolve_requested_components(&lookup)? {
            Some(slugs) => slugs,
            None => {
                self.finish();
                return Ok(CommandOutcome::NoOp);
            }
        };
        let component_entries = collect_components(self.client, &requested_slugs).await?;
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
            gather_component_files(self.client, &component_entries, &workspace_context).await?;

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

        let export_updates = sync_component_exports(
            self.dry_run,
            &workspace_context,
            &requested_entries,
            &all_component_files,
            &mut self.written_files,
        )?;
        self.report_export_updates(&export_updates);

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

    async fn fetch_component_lookup(&self) -> Result<HashMap<String, String>> {
        let registry = self.client.fetch_registry().await?;
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
            self.reporter.info(format!(
                "\n{}",
                "[dry-run] Would overwrite the files above".blue()
            ));
            self.reporter.blank();
            let spinner = create_spinner("[dry-run] Preparing file writes...");
            write_component_files(component_files, true, &mut self.written_files)?;
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
            write_component_files(component_files, false, &mut self.written_files)?;
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
        write_component_files(component_files, self.dry_run, &mut self.written_files)?;
        Ok(())
    }

    fn report_export_updates(&self, updates: &[ExportUpdate]) {
        if updates.is_empty() {
            return;
        }

        let heading = if self.dry_run {
            format!("{}", "[dry-run] Export barrels:".blue())
        } else {
            format!("{}", "Export barrels updated:".green())
        };
        self.reporter.info(format!("\n{}", heading));

        for update in updates {
            let action = match (self.dry_run, &update.change) {
                (true, ExportChangeKind::Created) => "Would create",
                (true, ExportChangeKind::Updated) => "Would update",
                (false, ExportChangeKind::Created) => "Created",
                (false, ExportChangeKind::Updated) => "Updated",
            };

            let summary = format!(
                "{} {} ({})",
                action,
                update.display_path.display(),
                update.workspace_label
            );
            self.reporter.info(format!("   {}", summary.dimmed()));
            for stmt in &update.statements {
                self.reporter.info(format!("      {}", stmt.dimmed()));
            }
        }
    }

    fn finish(&mut self) {
        self.spinner.finish_and_clear();
    }

    fn rollback(&self) {
        if self.dry_run || self.written_files.is_empty() {
            return;
        }

        match rollback_file_changes(&self.written_files) {
            Ok(_) => {
                self.reporter.warn(format!(
                    "{}",
                    "Rolled back written component files".yellow()
                ));
            }
            Err(err) => {
                self.reporter.error(format!(
                    "{}",
                    format!("Failed to roll back written files: {}", err).red()
                ));
            }
        }
    }
}

pub async fn run(
    client: &RegistryClient,
    reporter: &ConsoleReporter,
    args: AddArgs,
) -> CommandResult {
    let mut command = AddCommand::new(client, reporter, args);
    match command.execute().await {
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
    component_slug: String,
    file_type: String,
}

#[derive(Clone)]
struct PendingComponentFile {
    workspace_handle: WorkspaceHandle,
    workspace_id: String,
    absolute_path: PathBuf,
    display_path: PathBuf,
    component_name: String,
    component_slug: String,
    file_type: String,
    registry_path: String,
}

#[derive(Clone)]
struct FileChange {
    path: PathBuf,
    previous_contents: Option<Vec<u8>>,
}

#[derive(Clone, Default)]
struct WorkspaceDependencySet {
    regular: BTreeMap<String, String>,
    dev: BTreeMap<String, String>,
}

impl WorkspaceDependencySet {
    fn is_empty(&self) -> bool {
        self.regular.is_empty() && self.dev.is_empty()
    }
}

#[derive(Debug)]
struct ExportUpdate {
    workspace_label: String,
    display_path: PathBuf,
    statements: Vec<String>,
    change: ExportChangeKind,
}

#[derive(Debug)]
enum ExportChangeKind {
    Created,
    Updated,
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

async fn collect_components(
    client: &RegistryClient,
    requested_slugs: &[String],
) -> Result<Vec<ComponentEntry>> {
    let mut seen = HashSet::new();
    let mut entries = Vec::new();

    for slug in requested_slugs {
        let components = client.fetch_component_with_dependencies(slug).await?;
        for component in components {
            if seen.insert(component.slug.clone()) {
                entries.push(ComponentEntry {
                    slug: component.slug,
                    component: component.component,
                });
            }
        }
    }

    Ok(entries)
}

const FILE_FETCH_CONCURRENCY: usize = 6;

async fn gather_component_files(
    client: &RegistryClient,
    components: &[ComponentEntry],
    context: &WorkspaceContext,
) -> Result<(
    Vec<ComponentFileWithContent>,
    HashMap<String, WorkspaceDependencySet>,
)> {
    let mut files = Vec::new();
    let mut deps_per_workspace: HashMap<String, WorkspaceDependencySet> = HashMap::new();
    let mut pending_files = Vec::new();

    for entry in components {
        let mut workspace_ids_for_component = HashSet::new();

        for file in &entry.component.files {
            let handle = select_workspace_handle(context, file.target.as_deref())?.clone();
            let mut relative_path = resolve_component_path(&file.path, &handle.config);

            if let Some(flattened) =
                flatten_relative_path_for_slug(&relative_path, &handle.config, &entry.slug)
            {
                relative_path = flattened;
            }

            let absolute_path = handle.root_abs.join(&relative_path);
            let display_path = diff_paths(&absolute_path, &context.current_dir)
                .unwrap_or_else(|| absolute_path.clone());

            pending_files.push(PendingComponentFile {
                workspace_handle: handle.clone(),
                workspace_id: handle.id.clone(),
                absolute_path,
                display_path,
                component_name: entry.component.name.clone(),
                component_slug: entry.slug.clone(),
                file_type: file.file_type.clone(),
                registry_path: file.path.clone(),
            });

            workspace_ids_for_component.insert(handle.id.clone());
        }

        let preferred_target = select_dependency_target(&workspace_ids_for_component, context)?;

        if let Some(target_id) = preferred_target {
            let deps_entry = deps_per_workspace
                .entry(target_id.clone())
                .or_insert_with(WorkspaceDependencySet::default);
            for (name, version) in &entry.component.dependencies {
                deps_entry
                    .regular
                    .entry(name.clone())
                    .or_insert(version.clone());
            }
            for (name, version) in &entry.component.dev_dependencies {
                deps_entry
                    .dev
                    .entry(name.clone())
                    .or_insert(version.clone());
            }
        }
    }

    let client_ref = client;
    let mut fetch_results = stream::iter(pending_files.into_iter().map(|pending| async move {
        let contents = client_ref
            .fetch_component_file(&pending.registry_path)
            .await;
        (pending, contents)
    }))
    .buffer_unordered(FILE_FETCH_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;

    for (pending, contents_result) in fetch_results.drain(..) {
        let contents = contents_result.with_context(|| {
            format!("failed to fetch component asset {}", pending.registry_path)
        })?;
        let normalized = normalize_component_content(&contents, &pending.workspace_handle);
        files.push(ComponentFileWithContent {
            workspace_id: pending.workspace_id,
            absolute_path: pending.absolute_path,
            display_path: pending.display_path,
            content: normalized,
            component_name: pending.component_name,
            component_slug: pending.component_slug,
            file_type: pending.file_type,
        });
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

const EXPORT_BLOCK_START: &str = "// @nocta-ui/cli: auto-exports:start";
const EXPORT_BLOCK_END: &str = "// @nocta-ui/cli: auto-exports:end";
const EXPORT_BLOCK_COMMENT: &str =
    "// This section is auto-generated by Nocta UI CLI. Do not edit manually.";

fn sync_component_exports(
    dry_run: bool,
    context: &WorkspaceContext,
    component_entries: &[ComponentEntry],
    files: &[ComponentFileWithContent],
    file_changes: &mut Vec<FileChange>,
) -> Result<Vec<ExportUpdate>> {
    let mut updates = Vec::new();
    if component_entries.is_empty() {
        return Ok(updates);
    }

    let component_lookup: HashMap<&str, &ComponentEntry> = component_entries
        .iter()
        .map(|entry| (entry.slug.as_str(), entry))
        .collect();

    for handle in context.handles() {
        let Some(exports_cfg) = handle
            .config
            .exports
            .as_ref()
            .and_then(|cfg| cfg.components())
        else {
            continue;
        };

        if exports_cfg.strategy != ExportStrategy::Named {
            continue;
        }

        let workspace_files: Vec<&ComponentFileWithContent> = files
            .iter()
            .filter(|file| file.workspace_id == handle.id && file.file_type == "component")
            .collect();

        if workspace_files.is_empty() {
            continue;
        }

        let barrel_rel = Path::new(exports_cfg.barrel_path());
        let barrel_abs = handle.root_abs.join(barrel_rel);
        let barrel_dir = barrel_abs
            .parent()
            .unwrap_or_else(|| handle.root_abs.as_path());

        let mut new_entries: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for file in workspace_files {
            let Some(entry) = component_lookup.get(file.component_slug.as_str()) else {
                continue;
            };

            if entry.component.exports.is_empty() {
                continue;
            }

            let module_path = module_path_from_barrel(barrel_dir, &file.absolute_path);
            let export_entry = new_entries.entry(module_path).or_insert_with(BTreeSet::new);
            for name in &entry.component.exports {
                export_entry.insert(name.clone());
            }
        }

        if new_entries.is_empty() {
            continue;
        }

        let touched_modules: Vec<String> = new_entries.keys().cloned().collect();

        let existing_content = match read_file(&barrel_abs) {
            Ok(content) => Some(content),
            Err(err) => {
                if err.kind() == io::ErrorKind::NotFound {
                    None
                } else {
                    return Err(anyhow!(
                        "failed to read export barrel {}: {}",
                        barrel_abs.display(),
                        err
                    ));
                }
            }
        };

        let partition = existing_content
            .as_deref()
            .map(parse_existing_export_block)
            .unwrap_or_else(|| parse_existing_export_block(""));

        let mut merged_map = partition.existing_map.clone();
        for (module, names) in new_entries.into_iter() {
            merged_map
                .entry(module)
                .or_insert_with(BTreeSet::new)
                .extend(names.into_iter());
        }

        if merged_map == partition.existing_map {
            continue;
        }

        let export_lines = export_lines_from_map(&merged_map);
        let block = build_export_block(&export_lines);

        let mut new_content = String::new();
        new_content.push_str(&partition.before);
        if !partition.before.is_empty() && !partition.before.ends_with('\n') {
            new_content.push('\n');
        }
        new_content.push_str(&block);
        if !partition.after.is_empty() {
            if !block.ends_with('\n') {
                new_content.push('\n');
            }
            if !partition.after.starts_with('\n') && !new_content.ends_with('\n') {
                new_content.push('\n');
            }
            new_content.push_str(&partition.after);
        }

        let display_path =
            diff_paths(&barrel_abs, &context.current_dir).unwrap_or_else(|| barrel_abs.clone());

        if !dry_run {
            ensure_change_record(&barrel_abs, file_changes)?;
            write_file(&barrel_abs, &new_content).with_context(|| {
                format!("failed to write export barrel {}", barrel_abs.display())
            })?;
        }

        let touched_set: HashSet<String> = touched_modules.into_iter().collect();
        let statements = merged_map
            .iter()
            .filter(|(module, _)| touched_set.contains(module.as_str()))
            .map(|(module, names)| format_export_line(module, names))
            .collect::<Vec<_>>();

        let change = if existing_content.is_some() {
            ExportChangeKind::Updated
        } else {
            ExportChangeKind::Created
        };

        updates.push(ExportUpdate {
            workspace_label: handle.label.clone(),
            display_path,
            statements,
            change,
        });
    }

    Ok(updates)
}

#[derive(Default)]
struct ExportPartition {
    before: String,
    after: String,
    existing_map: BTreeMap<String, BTreeSet<String>>,
}

fn parse_existing_export_block(content: &str) -> ExportPartition {
    if content.is_empty() {
        return ExportPartition::default();
    }

    if let Some(start_idx) = content.find(EXPORT_BLOCK_START) {
        if let Some(end_rel_idx) = content[start_idx..].find(EXPORT_BLOCK_END) {
            let end_idx = start_idx + end_rel_idx;
            let block_body_start = start_idx + EXPORT_BLOCK_START.len();
            let block_body = &content[block_body_start..end_idx];
            let after_start = end_idx + EXPORT_BLOCK_END.len();
            let before = content[..start_idx].to_string();
            let after = if after_start < content.len() {
                content[after_start..].to_string()
            } else {
                String::new()
            };
            let existing_map = parse_export_lines(block_body);
            return ExportPartition {
                before,
                after,
                existing_map,
            };
        }
    }

    ExportPartition {
        before: content.to_string(),
        after: String::new(),
        existing_map: BTreeMap::new(),
    }
}

fn parse_export_lines(body: &str) -> BTreeMap<String, BTreeSet<String>> {
    let mut map = BTreeMap::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("//") {
            continue;
        }

        if let Some((module, names)) = parse_export_line(trimmed) {
            let entry = map.entry(module).or_insert_with(BTreeSet::new);
            for name in names {
                entry.insert(name);
            }
        }
    }
    map
}

fn parse_export_line(line: &str) -> Option<(String, Vec<String>)> {
    let export_body = line.strip_prefix("export")?.trim_start();
    let remainder = export_body.strip_prefix('{')?;
    let brace_end = remainder.find('}')?;
    let names_part = &remainder[..brace_end];
    let after_brace = remainder[brace_end + 1..].trim_start();
    let from_part = after_brace.strip_prefix("from")?.trim_start();
    let quote = from_part.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let after_quote = &from_part[1..];
    let module_end = after_quote.find(quote)?;
    let module = after_quote[..module_end].to_string();

    let names = names_part
        .split(',')
        .map(|name| name.trim())
        .filter(|name| !name.is_empty())
        .map(|name| name.to_string())
        .collect::<Vec<_>>();

    if names.is_empty() {
        return None;
    }

    Some((module, names))
}

fn export_lines_from_map(map: &BTreeMap<String, BTreeSet<String>>) -> Vec<String> {
    map.iter()
        .map(|(module, names)| format_export_line(module, names))
        .collect()
}

fn format_export_line(module: &str, names: &BTreeSet<String>) -> String {
    let joined = names.iter().cloned().collect::<Vec<_>>().join(", ");
    format!("export {{ {} }} from \"{}\";", joined, module)
}

fn build_export_block(lines: &[String]) -> String {
    let mut block = String::new();
    block.push_str(EXPORT_BLOCK_START);
    block.push('\n');
    block.push_str(EXPORT_BLOCK_COMMENT);
    block.push('\n');
    for line in lines {
        block.push_str(line);
        block.push('\n');
    }
    block.push_str(EXPORT_BLOCK_END);
    block.push('\n');
    block
}

fn module_path_from_barrel(barrel_dir: &Path, target_path: &Path) -> String {
    let relative = diff_paths(target_path, barrel_dir).unwrap_or_else(|| target_path.to_path_buf());
    let mut without_extension = relative.clone();
    if without_extension.extension().is_some() {
        without_extension.set_extension("");
    }
    let mut module = without_extension.to_string_lossy().replace('\\', "/");
    if module.starts_with('/') {
        module = format!(".{}", module);
    } else if !module.starts_with('.') {
        module = format!("./{}", module);
    }
    module
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
    file_changes: &mut Vec<FileChange>,
) -> Result<()> {
    for file in files {
        if dry_run {
            continue;
        }
        ensure_change_record(&file.absolute_path, file_changes)?;
        write_file(&file.absolute_path, &file.content)
            .with_context(|| format!("failed to write {}", file.display_path.display()))?;
    }
    Ok(())
}

fn ensure_change_record(path: &Path, changes: &mut Vec<FileChange>) -> Result<()> {
    if changes.iter().any(|change| change.path == path) {
        return Ok(());
    }

    let previous_contents = if path.exists() {
        Some(fs::read(path).with_context(|| format!("failed to snapshot {}", path.display()))?)
    } else {
        None
    };

    changes.push(FileChange {
        path: path.to_path_buf(),
        previous_contents,
    });

    Ok(())
}

fn rollback_file_changes(changes: &[FileChange]) -> Result<()> {
    for change in changes.iter().rev() {
        match &change.previous_contents {
            Some(contents) => {
                if let Some(parent) = change.path.parent() {
                    if !parent.as_os_str().is_empty() {
                        fs::create_dir_all(parent)
                            .with_context(|| format!("failed to recreate {}", parent.display()))?;
                    }
                }
                fs::write(&change.path, contents)
                    .with_context(|| format!("failed to restore {}", change.path.display()))?;
            }
            None => {
                if change.path.exists() {
                    fs::remove_file(&change.path)
                        .with_context(|| format!("failed to remove {}", change.path.display()))?;
                }
            }
        }
    }

    Ok(())
}

fn handle_workspace_dependencies(
    dry_run: bool,
    context: &WorkspaceContext,
    deps_by_workspace: &HashMap<String, WorkspaceDependencySet>,
    reporter: &ConsoleReporter,
) -> Result<()> {
    for handle in context.handles() {
        let spec = match deps_by_workspace.get(&handle.id) {
            Some(spec) if !spec.is_empty() => spec,
            _ => continue,
        };

        let base_path = handle
            .package_manager_context
            .workspace_root
            .as_ref()
            .map(|path| path.as_path())
            .unwrap_or_else(|| handle.root_abs.as_path());

        let installed = get_installed_dependencies_at(base_path)?;
        let mut required_map: HashMap<String, String> = HashMap::new();
        for (dep, version) in spec.regular.iter().chain(spec.dev.iter()) {
            required_map.insert(dep.clone(), version.clone());
        }
        let issues = check_project_requirements(base_path, &required_map)?;

        let mut deps_to_install = BTreeMap::new();
        let mut dev_deps_to_install = BTreeMap::new();
        let mut incompatible_regular = Vec::new();
        let mut incompatible_dev = Vec::new();
        let mut satisfied = Vec::new();

        for (dep, version) in &spec.regular {
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
                incompatible_regular.push(detail);
            } else if let Some(installed_version) = installed.get(dep) {
                satisfied.push(format!(
                    "{}@{} (satisfies {})",
                    dep, installed_version, version
                ));
            }
        }

        for (dep, version) in &spec.dev {
            if let Some(issue) = issues.iter().find(|issue| issue.name == *dep) {
                dev_deps_to_install.insert(dep.clone(), version.clone());
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
                incompatible_dev.push(detail);
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

        if !incompatible_regular.is_empty() {
            let incompatible_heading = if dry_run {
                format!(
                    "[dry-run] Would update incompatible dependencies in {}:",
                    handle.label
                )
            } else {
                format!("Incompatible dependencies updated in {}:", handle.label)
            };
            reporter.warn(format!("\n{}", incompatible_heading.yellow()));
            for entry in &incompatible_regular {
                reporter.info(format!("   {}", entry.dimmed()));
            }
        }

        if !incompatible_dev.is_empty() {
            let incompatible_heading = if dry_run {
                format!(
                    "[dry-run] Would update incompatible dev dependencies in {}:",
                    handle.label
                )
            } else {
                format!("Incompatible dev dependencies updated in {}:", handle.label)
            };
            reporter.warn(format!("\n{}", incompatible_heading.yellow()));
            for entry in &incompatible_dev {
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
                if let Some(plan) = plan_dependency_install(
                    &install_map,
                    &handle.package_manager_context,
                    DependencyScope::Regular,
                )? {
                    reporter.info(format!(
                        "{}",
                        format!("   Command: {}", plan.command_line().join(" ")).dimmed()
                    ));
                }
            } else if let Some(plan) = plan_dependency_install(
                &install_map,
                &handle.package_manager_context,
                DependencyScope::Regular,
            )? {
                plan.execute()?;
                reporter.info(format!(
                    "{}",
                    format!("Dependencies installed for {}.", handle.label).green()
                ));
            }
        }

        if !dev_deps_to_install.is_empty() {
            let install_heading = if dry_run {
                format!(
                    "[dry-run] Would install dev dependencies in {}:",
                    handle.label
                )
            } else {
                format!("Installing missing dev dependencies in {}...", handle.label)
            };
            reporter.info(format!("\n{}", install_heading.blue()));
            for (dep, version) in &dev_deps_to_install {
                reporter.info(format!("   {}", format!("{}@{}", dep, version).dimmed()));
            }

            let install_map: HashMap<String, String> = dev_deps_to_install
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();

            if dry_run {
                if let Some(plan) = plan_dependency_install(
                    &install_map,
                    &handle.package_manager_context,
                    DependencyScope::Dev,
                )? {
                    reporter.info(format!(
                        "{}",
                        format!("   Command: {}", plan.command_line().join(" ")).dimmed()
                    ));
                }
            } else if let Some(plan) = plan_dependency_install(
                &install_map,
                &handle.package_manager_context,
                DependencyScope::Dev,
            )? {
                plan.execute()?;
                reporter.info(format!(
                    "{}",
                    format!("Dev dependencies installed for {}.", handle.label).green()
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
    reporter.info(format!("{}", "Components installed:".green()));

    let mut files_by_workspace: BTreeMap<String, Vec<&ComponentFileWithContent>> = BTreeMap::new();
    for file in files {
        files_by_workspace
            .entry(file.workspace_id.clone())
            .or_default()
            .push(file);
    }

    for (workspace_id, entries) in &files_by_workspace {
        if let Some(handle) = context.handle_by_id(workspace_id) {
            reporter.info(format!(
                "{}",
                format!("  Workspace {}:", handle.label).blue()
            ));
            for file in entries {
                reporter.info(format!(
                    "     {}",
                    format!("{} ({})", file.display_path.display(), file.component_name).dimmed()
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
