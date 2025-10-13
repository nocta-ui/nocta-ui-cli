mod commands;

use anyhow::Result;
use clap::{Parser, Subcommand};

use commands::{add, init, list};
use nocta_core::RegistryClient;

const DEFAULT_REGISTRY_URL: &str = "https://nocta-ui.com/registry";

#[derive(Parser, Debug)]
#[command(
    name = "nocta-ui",
    version,
    about = "CLI for Nocta UI Components Library",
    author = "Nocta UI Team"
)]
struct Cli {
    /// Override registry endpoint (env: NOCTA_REGISTRY_URL)
    #[arg(long, global = true, env = "NOCTA_REGISTRY_URL")]
    registry_url: Option<String>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    Init(init::InitArgs),
    Add(add::AddArgs),
    List(list::ListArgs),
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    let registry_url = cli.registry_url.as_deref().unwrap_or(DEFAULT_REGISTRY_URL);

    let client = RegistryClient::new(registry_url);

    match cli.command {
        Commands::Init(args) => init::run(&client, args),
        Commands::Add(args) => add::run(&client, args),
        Commands::List(args) => list::run(&client, args),
    }
}
