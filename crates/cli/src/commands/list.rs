use anyhow::Result;
use clap::Args;
use owo_colors::OwoColorize;

use nocta_core::RegistryClient;

#[derive(Args, Debug, Clone, Default)]
pub struct ListArgs {}

pub fn run(client: &RegistryClient, _args: ListArgs) -> Result<()> {
    let registry = client.fetch_registry()?;

    println!("{}\n", "Available nocta-ui components:".blue().bold());

    let mut categories: Vec<_> = registry.categories.iter().collect();
    categories.sort_by(|(_, a), (_, b)| a.name.cmp(&b.name));

    for (_, category) in categories {
        println!("{}", category.name.yellow().bold());
        println!("  {}\n", category.description.clone().dimmed());

        let mut components: Vec<_> = category.components.iter().collect();
        components.sort();

        for component_name in components {
            if let Some(component) = registry.components.get(component_name) {
                println!("  {}", component.name.to_lowercase().green());
                println!("    {}", component.description.clone().dimmed());

                if !component.variants.is_empty() {
                    println!("  {} {}", "Variants:".blue(), component.variants.join(", "));
                }

                if !component.sizes.is_empty() {
                    println!("  {} {}", "Sizes:".blue(), component.sizes.join(", "));
                }

                println!();
            }
        }
    }

    println!("{}", "Add a component:".blue());
    println!("  {}", "npx nocta-ui add <component-name>".dimmed());

    println!("\n{}", "Examples:".blue());
    println!("  {}", "npx nocta-ui add button".dimmed());
    println!("  {}", "npx nocta-ui add card".dimmed());

    Ok(())
}
