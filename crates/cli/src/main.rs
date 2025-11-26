mod commands;
mod reporter;
mod util;

use std::process;

use clap::{Parser, Subcommand};

use commands::{CommandOutcome, CommandResult, add, cache, init, list};
use nocta_core::RegistryClient;
use nocta_core::constants::registry::DEFAULT_BASE_URL;
use reporter::ConsoleReporter;

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
    Cache(cache::CacheArgs),
}

#[tokio::main]
async fn main() {
    let reporter = ConsoleReporter::new();
    match run(&reporter).await {
        Ok(CommandOutcome::Completed) | Ok(CommandOutcome::NoOp) => {}
        Err(err) => {
            reporter.error(format!("Error: {:#}", err));
            process::exit(1);
        }
    }
}

async fn run(reporter: &ConsoleReporter) -> CommandResult {
    let cli = Cli::parse();

    let registry_url = cli.registry_url.as_deref().unwrap_or(DEFAULT_BASE_URL);

    let client = RegistryClient::new(registry_url);

    match cli.command {
        Commands::Init(args) => init::run(&client, reporter, args).await,
        Commands::Add(args) => add::run(&client, reporter, args).await,
        Commands::List(args) => list::run(&client, reporter, args).await,
        Commands::Cache(args) => cache::run(reporter, args).await,
    }
}
