use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result};
use clap::Args;
use dialoguer::Confirm;
use indicatif::{ProgressBar, ProgressStyle};
use once_cell::sync::Lazy;
use owo_colors::OwoColorize;
use regex::Regex;

use nocta_core::config::read_config;
use nocta_core::deps::{
    check_project_requirements, get_installed_dependencies, install_dependencies,
    RequirementIssueReason,
};
use nocta_core::framework::{detect_framework, FrameworkKind};
use nocta_core::fs::{file_exists, write_file};
use nocta_core::paths::resolve_component_path;
use nocta_core::registry::RegistryClient;
use nocta_core::rollback::rollback_changes;

use nocta_core::types::Component;

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

pub fn run(client: &RegistryClient, args: AddArgs) -> Result<()> {
    let dry_run = args.dry_run;
    let prefix = if dry_run { "[dry-run] " } else { "" };
    let mut written_paths: Vec<PathBuf> = Vec::new();

    let pb = create_spinner(format!(
        "{}Adding {}...",
        prefix,
        if args.components.len() > 1 {
            format!("{} components", args.components.len())
        } else {
            args.components[0].clone()
        }
    ));

    let result = add_inner(
        client,
        args,
        dry_run,
        prefix,
        pb.clone(),
        &mut written_paths,
    );

    match result {
        Ok(_) => Ok(()),
        Err(err) => {
            pb.finish_and_clear();
            if !dry_run && !written_paths.is_empty() {
                let _ = rollback_changes(&written_paths);
                println!("{}", "Rolled back written component files".yellow());
            }
            Err(err)
        }
    }
}

fn add_inner(
    client: &RegistryClient,
    args: AddArgs,
    dry_run: bool,
    prefix: &str,
    pb: ProgressBar,
    written_paths: &mut Vec<PathBuf>,
) -> Result<()> {
    let config = match read_config()? {
        Some(config) => config,
        None => {
            pb.finish_and_clear();
            println!("{}", "nocta.config.json not found".red());
            println!("{}", "Run \"npx nocta-ui init\" first".yellow());
            return Ok(());
        }
    };

    pb.set_message(format!("{}Detecting framework...", prefix));
    let framework_detection = detect_framework();
    let alias_prefix = config
        .alias_prefixes
        .as_ref()
        .and_then(|p| p.components.clone())
        .unwrap_or_else(|| {
            if framework_detection.framework == FrameworkKind::ReactRouter {
                "~".into()
            } else {
                "@".into()
            }
        });

    pb.set_message(format!("{}Fetching components and dependencies...", prefix));
    let registry = client.fetch_registry()?;
    let lookup = build_component_lookup(&registry.components);

    let mut requested_slugs = Vec::new();
    for name in &args.components {
        match lookup.get(&name.to_lowercase()) {
            Some(slug) => requested_slugs.push(slug.clone()),
            None => {
                pb.finish_and_clear();
                println!("{}", format!("Component \"{}\" not found", name).red());
                println!(
                    "{}",
                    "Run \"npx nocta-ui list\" to see available components".yellow()
                );
                return Ok(());
            }
        }
    }

    let component_entries = collect_components(client, &requested_slugs)?;
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

    pb.finish_and_clear();
    println!(
        "{}",
        format!(
            "Installing {}:",
            if args.components.len() > 1 {
                format!("{} components", args.components.len())
            } else {
                args.components[0].clone()
            }
        )
        .blue()
    );

    for entry in &requested_entries {
        println!(
            "   {}",
            format!("• {} (requested)", entry.component.name).green()
        );
    }

    if !dependency_entries.is_empty() {
        println!("\n{}", "With internal dependencies:".blue());
        for entry in &dependency_entries {
            println!("   {}", format!("• {}", entry.component.name).dimmed());
        }
    }

    println!("");
    let pb = create_spinner("Preparing components...".into());

    let all_component_files =
        gather_component_files(client, &component_entries, &config, &alias_prefix)?;

    pb.set_message("Checking existing files...");
    let existing_files = find_existing_files(&all_component_files);

    if !existing_files.is_empty() {
        pb.finish_and_clear();
        println!("{}", "The following files already exist:".yellow());
        for path in &existing_files {
            println!("   {}", path.display().to_string().dimmed());
        }

        if dry_run {
            println!("\n{}", "[dry-run] Would overwrite the files above".blue());
            println!("");
            let pb = create_spinner("[dry-run] Preparing file writes...".into());
            write_component_files(&all_component_files, dry_run, &config, written_paths)?;
            pb.finish_and_clear();
        } else {
            let overwrite = Confirm::new()
                .with_prompt("Do you want to overwrite these files?")
                .default(false)
                .interact()?;

            if !overwrite {
                println!("{}", "Installation cancelled".red());
                return Ok(());
            }

            let pb = create_spinner("Installing component files...".into());
            write_component_files(&all_component_files, dry_run, &config, written_paths)?;
            pb.finish_and_clear();
        }
    } else {
        if dry_run {
            pb.set_message("[dry-run] Preparing file writes...");
        } else {
            pb.set_message("Installing component files...");
        }
        write_component_files(&all_component_files, dry_run, &config, written_paths)?;
        pb.finish_and_clear();
    }

    let all_dependencies = collect_dependencies(&component_entries);
    if !all_dependencies.is_empty() {
        handle_dependencies(dry_run, &all_dependencies)?;
    }

    let pb = create_spinner(format!(
        "{}{}",
        prefix,
        if args.components.len() > 1 {
            format!("{} components", args.components.len())
        } else {
            args.components[0].clone()
        }
    ));
    pb.finish_with_message(format!(
        "{}{} {}",
        prefix,
        if args.components.len() > 1 {
            format!("{} components", args.components.len())
        } else {
            args.components[0].clone()
        },
        if dry_run {
            "would be added"
        } else {
            "added successfully!"
        }
    ));

    print_add_summary(
        dry_run,
        &config,
        &alias_prefix,
        &requested_entries,
        &all_component_files,
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

#[derive(Clone)]
struct ComponentEntry {
    slug: String,
    component: Component,
}

#[derive(Clone)]
struct ComponentFileWithContent {
    target_path: PathBuf,
    content: String,
    component_name: String,
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
    config: &nocta_core::types::Config,
    alias_prefix: &str,
) -> Result<Vec<ComponentFileWithContent>> {
    let mut files = Vec::new();

    for entry in components {
        for file in &entry.component.files {
            let contents = client
                .fetch_component_file(&file.path)
                .with_context(|| format!("failed to fetch component asset {}", file.path))?;
            let normalized = normalize_component_content(&contents, alias_prefix);
            let target_path = resolve_component_path(&file.path, config);
            files.push(ComponentFileWithContent {
                target_path,
                content: normalized,
                component_name: entry.component.name.clone(),
            });
        }
    }

    Ok(files)
}

fn normalize_component_content(content: &str, alias_prefix: &str) -> String {
    IMPORT_NORMALIZE_RE
        .replace_all(content, |caps: &regex::Captures| {
            let open = &caps[1];
            let path = normalize_import_path(&caps[2]);
            let close = &caps[3];
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
        .filter(|file| file_exists(&file.target_path))
        .map(|file| file.target_path.clone())
        .collect()
}

fn write_component_files(
    files: &[ComponentFileWithContent],
    dry_run: bool,
    _config: &nocta_core::types::Config,
    written_paths: &mut Vec<PathBuf>,
) -> Result<()> {
    for file in files {
        if dry_run {
            continue;
        }
        write_file(&file.target_path, &file.content)
            .with_context(|| format!("failed to write {}", file.target_path.display()))?;
        written_paths.push(file.target_path.clone());
    }
    Ok(())
}

fn collect_dependencies(components: &[ComponentEntry]) -> BTreeMap<String, String> {
    let mut deps = BTreeMap::new();
    for entry in components {
        for (name, version) in &entry.component.dependencies {
            deps.insert(name.clone(), version.clone());
        }
    }
    deps
}

fn handle_dependencies(dry_run: bool, deps: &BTreeMap<String, String>) -> Result<()> {
    let installed = get_installed_dependencies()?;
    let required_map: HashMap<String, String> =
        deps.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    let issues = check_project_requirements(&required_map)?;

    let mut deps_to_install = BTreeMap::new();
    let mut incompatible = Vec::new();
    let mut satisfied = Vec::new();

    for (dep, version) in deps {
        if let Some(issue) = issues.iter().find(|issue| issue.name == *dep) {
            deps_to_install.insert(dep.clone(), version.clone());
            let detail = match issue.reason {
                RequirementIssueReason::Missing => format!("{}: required {}", dep, version),
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
        println!("\n{}", "Dependencies already satisfied:".green());
        for entry in satisfied {
            println!("   {}", entry.dimmed());
        }
    }

    if !incompatible.is_empty() {
        println!(
            "\n{}",
            if dry_run {
                "[dry-run] Would update incompatible dependencies:".yellow()
            } else {
                "Incompatible dependencies updated:".yellow()
            }
        );
        for entry in &incompatible {
            println!("   {}", entry.dimmed());
        }
    }

    if !deps_to_install.is_empty() {
        println!(
            "\n{}",
            if dry_run {
                "[dry-run] Would install dependencies:".blue()
            } else {
                "Installing missing dependencies...".blue()
            }
        );
        for (dep, version) in &deps_to_install {
            println!("   {}", format!("{}@{}", dep, version).dimmed());
        }

        if !dry_run {
            let install_map: HashMap<String, String> = deps_to_install
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            install_dependencies(&install_map)?;
            println!("{}", "Dependencies installed.".green());
        }
    }

    Ok(())
}

fn print_add_summary(
    dry_run: bool,
    config: &nocta_core::types::Config,
    alias_prefix: &str,
    requested_components: &[ComponentEntry],
    files: &[ComponentFileWithContent],
) {
    println!("\n{}", "Components installed:".green());
    for file in files {
        println!(
            "   {}",
            format!("{} ({})", file.target_path.display(), file.component_name).dimmed()
        );
    }

    let heading = if dry_run {
        "[dry-run] Example imports:".blue()
    } else {
        "Import and use:".blue()
    };
    println!("\n{}", heading);

    let base_alias = normalize_alias_path(&config.aliases.components);
    let alias_base = if base_alias.is_empty() {
        alias_prefix.to_string()
    } else {
        join_import_path(alias_prefix, &base_alias)
    };

    for component in requested_components {
        if let Some(first_file) = component.component.files.first() {
            let mut component_path = first_file.path.replace("components/", "");
            if let Some(stripped) = component_path.strip_suffix(".tsx") {
                component_path = stripped.to_string();
            }
            println!(
                "   {}",
                format!(
                    "import {{ {} }} from \"{}\"; // {}",
                    component.component.exports.join(", "),
                    join_import_path(&alias_base, &component_path),
                    component.component.name
                )
                .dimmed()
            );
        }
    }

    let variants: Vec<_> = requested_components
        .iter()
        .filter(|entry| !entry.component.variants.is_empty())
        .collect();
    if !variants.is_empty() {
        println!("\n{}", "Available variants:".blue());
        for entry in variants {
            println!(
                "   {}",
                format!(
                    "{}: {}",
                    entry.component.name,
                    entry.component.variants.join(", ")
                )
                .dimmed()
            );
        }
    }

    let sizes: Vec<_> = requested_components
        .iter()
        .filter(|entry| !entry.component.sizes.is_empty())
        .collect();
    if !sizes.is_empty() {
        println!("\n{}", "Available sizes:".blue());
        for entry in sizes {
            println!(
                "   {}",
                format!(
                    "{}: {}",
                    entry.component.name,
                    entry.component.sizes.join(", ")
                )
                .dimmed()
            );
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
