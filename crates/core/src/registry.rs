use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::env;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use crc32fast::Hasher as Crc32Hasher;
use reqwest::header::{ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH, LAST_MODIFIED};
use reqwest::{Client, Error as ReqwestError, StatusCode};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::cache;
use crate::constants::registry as registry_constants;
use crate::types::{CategoryInfo, Component, Registry};

#[derive(Debug, Clone)]
struct ComponentManifest {
    by_path: HashMap<String, String>,
    fallback_by_file: HashMap<String, String>,
}

impl ComponentManifest {
    fn from_raw(entries: HashMap<String, String>) -> Self {
        let mut by_path = HashMap::new();
        let mut fallback_by_file = HashMap::new();

        for (key, value) in entries {
            let normalized = normalize_manifest_key(&key);
            if normalized.contains('/') {
                by_path.insert(normalized, value);
            } else {
                fallback_by_file.insert(normalized, value);
            }
        }

        Self {
            by_path,
            fallback_by_file,
        }
    }

    fn lookup(&self, requested_path: &str) -> Option<&String> {
        let normalized = normalize_manifest_key(requested_path);
        if let Some(value) = self.by_path.get(&normalized) {
            return Some(value);
        }

        normalized
            .rsplit('/')
            .next()
            .and_then(|name| self.fallback_by_file.get(name))
    }
}

fn normalize_manifest_key(path: &str) -> String {
    path.replace('\\', "/")
        .trim_start_matches("./")
        .trim_start_matches('/')
        .to_string()
}

fn default_registry_ttl() -> Duration {
    Duration::from_millis(
        env::var(registry_constants::CACHE_TTL_ENV)
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(registry_constants::DEFAULT_CACHE_TTL_MS),
    )
}

fn default_asset_ttl() -> Duration {
    Duration::from_millis(
        env::var(registry_constants::ASSET_CACHE_TTL_ENV)
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(registry_constants::DEFAULT_ASSET_CACHE_TTL_MS),
    )
}

#[derive(Debug, Error)]
pub enum RegistryError {
    #[error("network error: {0}")]
    Network(String),
    #[error("failed to parse registry response: {0}")]
    Parse(String),
    #[error("component `{0}` not found in registry")]
    ComponentNotFound(String),
    #[error("failed to decode registry asset `{0}`: {1}")]
    Decode(String, String),
    #[error("failed to parse registry asset `{0}`: {1}")]
    AssetParse(String, String),
}

fn map_network_error(err: ReqwestError) -> RegistryError {
    RegistryError::Network(err.to_string())
}

fn cache_namespace_for(base_url: &str) -> String {
    let mut hasher = Crc32Hasher::new();
    hasher.update(base_url.trim().as_bytes());
    format!("registry/{:08x}", hasher.finalize())
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct HttpCacheMetadata {
    etag: Option<String>,
    last_modified: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RegistrySummary {
    pub name: String,
    pub version: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RegistryComponent {
    pub slug: String,
    pub component: Component,
}

pub struct RegistryClient {
    client: Client,
    base_url: String,
    cache_namespace: String,
    components_manifest: RefCell<Option<Arc<ComponentManifest>>>,
    registry_cache: RefCell<Option<(String, Registry)>>,
}

impl RegistryClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        let base_url = base_url.into();
        Self {
            client: Client::new(),
            cache_namespace: cache_namespace_for(&base_url),
            base_url,
            components_manifest: RefCell::new(None),
            registry_cache: RefCell::new(None),
        }
    }

    fn base_url(&self) -> &str {
        self.base_url.trim_end_matches('/')
    }

    fn registry_url(&self) -> String {
        format!(
            "{}/{}",
            self.base_url(),
            registry_constants::REGISTRY_MANIFEST
        )
    }

    fn asset_url(&self, asset: &str) -> String {
        format!("{}/{}", self.base_url(), asset.trim_start_matches('/'))
    }

    fn namespaced_path(&self, rel_path: &str) -> String {
        format!(
            "{}/{}",
            self.cache_namespace,
            rel_path.trim_start_matches('/')
        )
    }

    fn read_cache(&self, path: &str, ttl: Duration, accept_stale: bool) -> Option<String> {
        match cache::read_cache_text(path, Some(ttl), accept_stale) {
            Ok(Some(text)) => Some(text),
            _ => None,
        }
    }

    fn write_cache(&self, path: &str, contents: &str) {
        let _ = cache::write_cache_text(path, contents);
    }

    fn load_cache_metadata(&self, cache_path: &str) -> HttpCacheMetadata {
        match cache::read_cache_metadata(cache_path) {
            Ok(Some(bytes)) => serde_json::from_slice(&bytes).unwrap_or_default(),
            _ => HttpCacheMetadata::default(),
        }
    }

    fn store_cache_metadata(&self, cache_path: &str, metadata: HttpCacheMetadata) {
        if metadata.etag.is_none() && metadata.last_modified.is_none() {
            let _ = cache::remove_cache_metadata(cache_path);
            return;
        }

        if let Ok(bytes) = serde_json::to_vec(&metadata) {
            let _ = cache::write_cache_metadata(cache_path, &bytes);
        }
    }

    async fn fetch_with_cache(
        &self,
        url: &str,
        cache_relative: &str,
        ttl: Duration,
    ) -> Result<String, RegistryError> {
        let cache_path = self.namespaced_path(cache_relative);

        if let Some(fresh) = self.read_cache(&cache_path, ttl, false) {
            return Ok(fresh);
        }

        let metadata = self.load_cache_metadata(&cache_path);
        let mut request = self.client.get(url);
        if let Some(etag) = &metadata.etag {
            request = request.header(IF_NONE_MATCH, etag);
        }
        if let Some(last_modified) = &metadata.last_modified {
            request = request.header(IF_MODIFIED_SINCE, last_modified);
        }

        match request.send().await {
            Ok(response) => {
                let status = response.status();
                if status == StatusCode::NOT_MODIFIED {
                    if let Some(cached) = self.read_cache(&cache_path, ttl, true) {
                        return Ok(cached);
                    }

                    return Err(RegistryError::Network(
                        "registry returned 304 but cache entry is missing".into(),
                    ));
                }

                if !status.is_success() {
                    if let Some(cached) = self.read_cache(&cache_path, ttl, true) {
                        return Ok(cached);
                    }
                    return Err(RegistryError::Network(format!(
                        "registry request failed with status {}",
                        status
                    )));
                }

                let etag = response
                    .headers()
                    .get(ETAG)
                    .and_then(|value| value.to_str().ok())
                    .map(|value| value.to_string());
                let last_modified = response
                    .headers()
                    .get(LAST_MODIFIED)
                    .and_then(|value| value.to_str().ok())
                    .map(|value| value.to_string());

                match response.text().await {
                    Ok(body) => {
                        self.write_cache(&cache_path, &body);
                        self.store_cache_metadata(
                            &cache_path,
                            HttpCacheMetadata {
                                etag,
                                last_modified,
                            },
                        );
                        Ok(body)
                    }
                    Err(err) => {
                        if let Some(cached) = self.read_cache(&cache_path, ttl, true) {
                            Ok(cached)
                        } else {
                            Err(RegistryError::Network(err.to_string()))
                        }
                    }
                }
            }
            Err(err) => {
                if let Some(cached) = self.read_cache(&cache_path, ttl, true) {
                    Ok(cached)
                } else {
                    Err(map_network_error(err))
                }
            }
        }
    }

    pub async fn fetch_registry(&self) -> Result<Registry, RegistryError> {
        let body = self
            .fetch_with_cache(
                &self.registry_url(),
                registry_constants::CACHE_PATH,
                default_registry_ttl(),
            )
            .await?;
        if let Some((cached_body, registry)) = self.registry_cache.borrow().as_ref() {
            if cached_body == &body {
                return Ok(registry.clone());
            }
        }

        let registry = serde_json::from_str::<Registry>(&body)
            .map_err(|err| RegistryError::Parse(err.to_string()))?;
        self.registry_cache.replace(Some((body, registry.clone())));
        Ok(registry)
    }

    pub async fn fetch_summary(&self) -> Result<RegistrySummary, RegistryError> {
        let registry = self.fetch_registry().await?;
        Ok(RegistrySummary {
            name: registry.name,
            version: registry.version,
            description: registry.description,
        })
    }

    pub async fn list_components(&self) -> Result<Vec<Component>, RegistryError> {
        let registry = self.fetch_registry().await?;
        Ok(registry.components.into_values().collect())
    }

    pub async fn categories(&self) -> Result<HashMap<String, CategoryInfo>, RegistryError> {
        let registry = self.fetch_registry().await?;
        Ok(registry.categories)
    }

    pub async fn registry_requirements(&self) -> Result<HashMap<String, String>, RegistryError> {
        let registry = self.fetch_registry().await?;
        Ok(registry.requirements)
    }

    pub async fn fetch_component(&self, name: &str) -> Result<Component, RegistryError> {
        let registry = self.fetch_registry().await?;
        registry
            .components
            .get(name)
            .cloned()
            .ok_or_else(|| RegistryError::ComponentNotFound(name.to_string()))
    }

    pub async fn fetch_component_with_dependencies(
        &self,
        component: &str,
    ) -> Result<Vec<RegistryComponent>, RegistryError> {
        let registry = self.fetch_registry().await?;
        let mut ordered = Vec::new();
        let mut visiting = HashSet::new();
        let mut visited = HashSet::new();

        self.collect_component_with_dependencies(
            &registry.components,
            component,
            &mut visiting,
            &mut visited,
            &mut ordered,
        )?;

        Ok(ordered)
    }

    fn collect_component_with_dependencies(
        &self,
        components: &HashMap<String, Component>,
        component: &str,
        visiting: &mut HashSet<String>,
        visited: &mut HashSet<String>,
        ordered: &mut Vec<RegistryComponent>,
    ) -> Result<(), RegistryError> {
        if visited.contains(component) {
            return Ok(());
        }

        if !visiting.insert(component.to_string()) {
            return Ok(());
        }

        let current = components
            .get(component)
            .ok_or_else(|| RegistryError::ComponentNotFound(component.to_string()))?;

        if !current.internal_dependencies.is_empty() {
            for dep in &current.internal_dependencies {
                self.collect_component_with_dependencies(
                    components, dep, visiting, visited, ordered,
                )?;
            }
        }

        visiting.remove(component);
        visited.insert(component.to_string());
        ordered.push(RegistryComponent {
            slug: component.to_string(),
            component: current.clone(),
        });
        Ok(())
    }

    pub async fn fetch_registry_asset(&self, asset_path: &str) -> Result<String, RegistryError> {
        let normalized = asset_path.trim_start_matches('/');
        let url = self.asset_url(normalized);
        let cache_path = format!("assets/{}", normalized);
        self.fetch_with_cache(&url, &cache_path, default_asset_ttl())
            .await
    }

    async fn load_components_manifest(&self) -> Result<Arc<ComponentManifest>, RegistryError> {
        if let Some(manifest) = self.components_manifest.borrow().as_ref() {
            return Ok(Arc::clone(manifest));
        }

        let manifest_text = self
            .fetch_registry_asset(registry_constants::COMPONENTS_MANIFEST)
            .await?;
        let manifest: HashMap<String, String> =
            serde_json::from_str(&manifest_text).map_err(|err| {
                RegistryError::AssetParse(
                    registry_constants::COMPONENTS_MANIFEST.into(),
                    err.to_string(),
                )
            })?;
        let manifest = Arc::new(ComponentManifest::from_raw(manifest));
        self.components_manifest
            .replace(Some(Arc::clone(&manifest)));
        Ok(manifest)
    }

    pub async fn fetch_component_file(&self, path: &str) -> Result<String, RegistryError> {
        let manifest = self.load_components_manifest().await?;
        let encoded = manifest
            .lookup(path)
            .cloned()
            .ok_or_else(|| RegistryError::ComponentNotFound(path.to_string()))?;

        BASE64_STANDARD
            .decode(encoded)
            .map_err(|err| RegistryError::Decode(path.to_string(), err.to_string()))
            .and_then(|bytes| {
                String::from_utf8(bytes)
                    .map_err(|err| RegistryError::Decode(path.to_string(), err.to_string()))
            })
    }
}
