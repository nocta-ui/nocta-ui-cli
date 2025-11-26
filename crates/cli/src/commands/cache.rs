use anyhow::Context;
use clap::{Args, Subcommand};
use nocta_core::cache;

use crate::commands::{CommandOutcome, CommandResult};
use crate::reporter::ConsoleReporter;

#[derive(Args, Debug)]
pub struct CacheArgs {
    #[command(subcommand)]
    pub command: Option<CacheCommand>,
}

#[derive(Subcommand, Debug)]
pub enum CacheCommand {
    /// Print the cache directory location.
    Info,
    /// Remove all cached registry data.
    Clear {
        /// Confirm cache deletion without interactive prompt.
        #[arg(long, short = 'y', alias = "yes")]
        force: bool,
    },
}

pub fn run(reporter: &ConsoleReporter, args: CacheArgs) -> CommandResult {
    match args.command.unwrap_or(CacheCommand::Info) {
        CacheCommand::Info => {
            let dir = cache::cache_dir();
            reporter.info(format!("Cache directory: {}", dir.display()));
            Ok(CommandOutcome::Completed)
        }
        CacheCommand::Clear { force } => {
            if !force {
                reporter.warn("Cache not cleared. Re-run with `--force` to confirm deletion.");
                return Ok(CommandOutcome::NoOp);
            }

            cache::clear_cache().context("failed to clear cache")?;
            reporter.info("Cache directory removed.");
            Ok(CommandOutcome::Completed)
        }
    }
}
