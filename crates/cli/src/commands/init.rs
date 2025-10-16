use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use clap::Args;
use indicatif::{ProgressBar, ProgressStyle};
use owo_colors::OwoColorize;

use nocta_core::config::{read_config, write_config};
use nocta_core::deps::{
    check_project_requirements, install_dependencies, RequirementIssue, RequirementIssueReason,
};
use nocta_core::framework::{detect_framework, AppStructure, FrameworkKind};
use nocta_core::fs::{file_exists, write_file};
use nocta_core::paths::resolve_component_path;
use nocta_core::registry::RegistryClient;
use nocta_core::rollback::rollback_changes;
use nocta_core::tailwind::{add_design_tokens_to_css, check_tailwind_installation, TailwindCheck};
use nocta_core::types::{AliasPrefixes, Aliases, Config, TailwindConfig};

#[derive(Args, Debug, Clone)]
pub struct InitArgs {
    #[arg(long = "dry-run")]
    pub dry_run: bool,
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

    pb.set_message(format!("{}Checking Tailwind CSS installation...", prefix));
    let tailwind = check_tailwind_installation();

    if !tailwind.installed {
        pb.finish_and_clear();
        print_tailwind_missing_message(&tailwind);
        return Ok(());
    }

    pb.set_message(format!("{}Detecting project framework...", prefix));
    let framework_detection = detect_framework();

    if framework_detection.framework == FrameworkKind::Unknown {
        pb.finish_and_clear();
        print_framework_unknown_message(&framework_detection);
        return Ok(());
    }

    pb.set_message(format!("{}Validating project requirements...", prefix));
    let requirements = client.registry_requirements()?;
    let requirement_issues = check_project_requirements(&requirements)?;
    if !requirement_issues.is_empty() {
        pb.finish_and_clear();
        print_requirement_issues(&requirement_issues);
        return Ok(());
    }

    let is_tailwind_v4 = tailwind_v4(&tailwind);
    if !is_tailwind_v4 {
        pb.finish_and_clear();
        print_tailwind_v4_required(&tailwind);
        return Ok(());
    }

    pb.set_message(format!("{}Creating configuration...", prefix));

    let mut config = build_config(&framework_detection)?;
    config.alias_prefixes = Some(AliasPrefixes {
        components: Some(config_alias_prefix(&framework_detection)),
        utils: Some(config_alias_prefix(&framework_detection)),
    });

    if dry_run {
        println!("\n{}", "[dry-run] Would create configuration:".blue());
        println!("   {}", "nocta.config.json".dimmed());
    } else {
        write_config(&config).context("failed to write nocta.config.json")?;
        created_paths.push(PathBuf::from("nocta.config.json"));
    }

    let required_dependencies = required_dependencies();
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
        if let Err(err) = install_dependencies(&install_map) {
            pb.suspend(|| {
                println!(
                    "{}",
                    "Dependencies installation failed, but you can install them manually".yellow()
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

    pb.set_message(format!("{}Creating utility functions...", prefix));
    let utils_path = PathBuf::from(format!("{}.ts", config.aliases.utils));
    let utils_created = ensure_registry_asset(
        client,
        dry_run,
        "lib/utils.ts",
        &utils_path,
        created_paths,
        "Utility functions",
    )?;

    pb.set_message(format!("{}Creating base icons component...", prefix));
    let icons_path = resolve_component_path("components/icons.ts", &config);
    let icons_created = ensure_registry_asset(
        client,
        dry_run,
        "icons/icons.ts",
        &icons_path,
        created_paths,
        "Icons component",
    )?;

    pb.set_message(format!("{}Adding semantic color variables...", prefix));
    let mut tokens_added = false;
    if dry_run {
        if !file_has_tokens(config.tailwind.css.as_str())? {
            tokens_added = true;
        }
    } else if add_design_tokens_to_css(client, config.tailwind.css.as_str())? {
        tokens_added = true;
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

    print_init_summary(
        dry_run,
        &config,
        framework_info(&framework_detection),
        &required_dependencies,
        utils_created.then_some(utils_path.as_path()),
        icons_created.then_some(icons_path.as_path()),
        tokens_added,
        is_tailwind_v4,
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

fn print_requirement_issues(issues: &[RequirementIssue]) {
    println!("{}", "Project requirements not satisfied!".red());
    println!("{}", "Please update the following dependencies:".red());
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
                println!("{}", "      update to a compatible version".dimmed());
            }
            RequirementIssueReason::Unknown => {
                println!("{}", "      unable to determine installed version".dimmed());
            }
            RequirementIssueReason::Missing => {}
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
}

fn required_dependencies() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("@ariakit/react".to_string(), "^0.4.18".to_string()),
        ("@radix-ui/react-icons".to_string(), "^1.3.2".to_string()),
        ("class-variance-authority".to_string(), "^0.7.1".to_string()),
        ("clsx".to_string(), "^2.1.1".to_string()),
        ("tailwind-merge".to_string(), "^3.3.1".to_string()),
    ])
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

fn build_config(detection: &nocta_core::framework::FrameworkDetection) -> Result<Config> {
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
            })
        }
        FrameworkKind::Unknown => Err(anyhow!("Unsupported framework configuration")),
    }
}

fn print_init_summary(
    dry_run: bool,
    config: &Config,
    framework_info: String,
    dependencies: &BTreeMap<String, String>,
    utils_path: Option<&Path>,
    icons_path: Option<&Path>,
    tokens_added: bool,
    tailwind_is_v4: bool,
) {
    println!("{}", "\nConfiguration created:".green());
    println!(
        "{}",
        format!("   nocta.config.json ({})", framework_info).dimmed()
    );

    let dep_heading = if dry_run {
        "[dry-run] Would install dependencies:".blue()
    } else {
        "Dependencies installed:".blue()
    };
    println!("\n{}", dep_heading);
    for (dep, version) in dependencies {
        println!("   {}", format!("{}@{}", dep, version).dimmed());
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

    if tokens_added {
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
    } else {
        println!(
            "\n{}",
            "Design tokens skipped (already exist or error occurred)".yellow()
        );
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
