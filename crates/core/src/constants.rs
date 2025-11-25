/// Shared constants used across the Nocta CLI and core library.
pub mod registry {
    /// Default base endpoint for the Nocta components registry.
    pub const DEFAULT_BASE_URL: &str = "https://www.nocta-ui.com/registry";

    /// Relative cache location for the registry manifest.
    pub const CACHE_PATH: &str = "registry/registry.json";

    /// Registry manifest filename served by the API.
    pub const REGISTRY_MANIFEST: &str = "registry.json";

    /// Relative path for the components manifest served by the registry.
    pub const COMPONENTS_MANIFEST: &str = "components.json";

    /// Relative path for CSS assets served by the registry.
    pub const CSS_BUNDLE_PATH: &str = "css/index.css";

    /// Environment variable that overrides the registry cache TTL in milliseconds.
    pub const CACHE_TTL_ENV: &str = "NOCTA_CACHE_TTL_MS";

    /// Default registry cache TTL in milliseconds (10 minutes).
    pub const DEFAULT_CACHE_TTL_MS: u64 = 10 * 60 * 1000;

    /// Environment variable that overrides the asset cache TTL in milliseconds.
    pub const ASSET_CACHE_TTL_ENV: &str = "NOCTA_ASSET_CACHE_TTL_MS";

    /// Default asset cache TTL in milliseconds (24 hours).
    pub const DEFAULT_ASSET_CACHE_TTL_MS: u64 = 24 * 60 * 60 * 1000;
}
