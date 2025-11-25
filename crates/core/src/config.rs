use std::fs;
use std::io;
use std::path::Path;

use thiserror::Error;

use crate::types::Config;

pub const CONFIG_FILE_NAME: &str = "nocta.config.json";
pub const DEFAULT_SCHEMA_URL: &str = "https://www.nocta-ui.com/registry/config-schema.json";

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("failed to read config file: {0}")]
    Read(io::Error),
    #[error("failed to parse config file: {0}")]
    Parse(serde_json::Error),
    #[error("failed to serialize config file: {0}")]
    Serialize(serde_json::Error),
    #[error("failed to write config file: {0}")]
    Write(io::Error),
}

pub fn read_config() -> Result<Option<Config>, ConfigError> {
    read_config_from(CONFIG_FILE_NAME)
}

pub fn read_config_from<P: AsRef<Path>>(path: P) -> Result<Option<Config>, ConfigError> {
    let path = path.as_ref();
    if !path.exists() {
        return Ok(None);
    }

    let data = fs::read_to_string(path).map_err(ConfigError::Read)?;
    if data.trim().is_empty() {
        return Ok(None);
    }

    let config = serde_json::from_str::<Config>(&data).map_err(ConfigError::Parse)?;
    Ok(Some(config))
}

pub fn write_config(config: &Config) -> Result<(), ConfigError> {
    write_config_to(CONFIG_FILE_NAME, config)
}

pub fn write_config_to<P: AsRef<Path>>(path: P, config: &Config) -> Result<(), ConfigError> {
    let path = path.as_ref();
    ensure_parent_dir(path).map_err(ConfigError::Write)?;

    let mut doc = config.clone();
    if doc.schema.is_none() {
        doc.schema = Some(DEFAULT_SCHEMA_URL.to_string());
    }

    let json = serde_json::to_string_pretty(&doc).map_err(ConfigError::Serialize)?;
    fs::write(path, json).map_err(ConfigError::Write)
}

pub fn ensure_parent_dir(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    Ok(())
}
