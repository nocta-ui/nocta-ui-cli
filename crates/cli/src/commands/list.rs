use clap::Args;
use owo_colors::OwoColorize;

use crate::commands::{CommandOutcome, CommandResult};
use crate::reporter::ConsoleReporter;
use nocta_core::RegistryClient;

#[derive(Args, Debug, Clone, Default)]
pub struct ListArgs {}

pub fn run(client: &RegistryClient, reporter: &ConsoleReporter, _args: ListArgs) -> CommandResult {
    let registry = client.fetch_registry()?;

    reporter.info(format!("{}\n", "Available nocta-ui components:".blue().bold()));

    let mut categories: Vec<_> = registry.categories.iter().collect();
    categories.sort_by(|(_, a), (_, b)| a.name.cmp(&b.name));

    for (_, category) in categories {
        reporter.info(format!("{}", category.name.yellow().bold()));
        reporter.info(format!("  {}\n", category.description.clone().dimmed()));

        let mut components: Vec<_> = category.components.iter().collect();
        components.sort();

        for component_name in components {
            if let Some(component) = registry.components.get(component_name) {
                reporter.info(format!("  {}", component.name.to_lowercase().green()));
                reporter.info(format!(
                    "    {}",
                    component.description.clone().dimmed()
                ));

                if !component.variants.is_empty() {
                    reporter.info(format!(
                        "  {} {}",
                        "Variants:".blue(),
                        component.variants.join(", ")
                    ));
                }

                if !component.sizes.is_empty() {
                    reporter.info(format!(
                        "  {} {}",
                        "Sizes:".blue(),
                        component.sizes.join(", ")
                    ));
                }

                reporter.blank();
            }
        }
    }

    reporter.info(format!("{}", "Add a component:".blue()));
    reporter.info(format!("  {}", "npx nocta-ui add <component-name>".dimmed()));

    reporter.info(format!("\n{}", "Examples:".blue()));
    reporter.info(format!("  {}", "npx nocta-ui add button".dimmed()));
    reporter.info(format!("  {}", "npx nocta-ui add card".dimmed()));

    Ok(CommandOutcome::Completed)
}
