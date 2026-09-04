//! Repo layout loaded from `contract/manifest/repo-paths.yaml`.
//!
//! Root discovery walks ancestors for `pnpm-workspace.yaml` and never counts
//! `CARGO_MANIFEST_DIR` hops. Callers in other crates should use [`load`] /
//! [`try_repo_root`] instead of `env!("CARGO_MANIFEST_DIR")`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use thiserror::Error;

/// Marker file that identifies the solvapay-sdk monorepo root.
const WORKSPACE_MARKER: &str = "pnpm-workspace.yaml";

/// Repo-root-relative location of the layout manifest.
const MANIFEST_REL: &str = "contract/manifest/repo-paths.yaml";

/// Failures locating the repo or loading the layout manifest.
#[derive(Debug, Error)]
pub enum RepoPathsError {
    /// No `pnpm-workspace.yaml` between `start` and the filesystem root.
    #[error("pnpm-workspace.yaml not found walking up from {start}")]
    RootNotFound {
        /// Directory the walk started from.
        start: PathBuf,
    },
    /// Filesystem error reading a path.
    #[error("read {path}: {source}")]
    Io {
        /// Path that could not be read.
        path: PathBuf,
        /// Underlying OS error.
        #[source]
        source: std::io::Error,
    },
    /// YAML did not match the expected layout schema.
    #[error("parse {path}: {message}")]
    Parse {
        /// Manifest path that failed to parse.
        path: PathBuf,
        /// Parser or schema message.
        message: String,
    },
    /// `generated` id is not in the manifest.
    #[error("unknown generated artifact id: {0}")]
    UnknownGenerated(String),
    /// `lookups` key is not in the manifest.
    #[error("unknown repo-paths lookup: {0}")]
    UnknownLookup(String),
    /// `contractInputs` key is not in the manifest.
    #[error("unknown contract input: {0}")]
    UnknownContractInput(String),
    /// Package map key is not in the manifest.
    #[error("unknown {kind} package: {id}")]
    UnknownPackage {
        /// Package map (`ts`, `tool`, or `internal`).
        kind: String,
        /// Package id.
        id: String,
    },
}

/// Result alias for this crate.
pub type Result<T> = std::result::Result<T, RepoPathsError>;

/// Walk `start` and its ancestors until `pnpm-workspace.yaml` is found.
pub fn try_repo_root_from(start: &Path) -> Result<PathBuf> {
    let mut dir = start.to_path_buf();
    loop {
        if dir.join(WORKSPACE_MARKER).is_file() {
            return Ok(dir);
        }
        let Some(parent) = dir.parent() else {
            return Err(RepoPathsError::RootNotFound {
                start: start.to_path_buf(),
            });
        };
        if parent == dir {
            return Err(RepoPathsError::RootNotFound {
                start: start.to_path_buf(),
            });
        }
        dir = parent.to_path_buf();
    }
}

/// Repo root discovered by walking up from this crate's manifest directory.
pub fn try_repo_root() -> Result<PathBuf> {
    try_repo_root_from(Path::new(env!("CARGO_MANIFEST_DIR")))
}

/// One substring that must not appear in an external-generated path.
#[derive(Debug, Clone, Deserialize)]
pub struct ForbidPattern {
    /// Repo-root-relative file to scan.
    pub path: String,
    /// Substring that must not appear.
    pub pattern: String,
    /// Human-readable reason printed on hit.
    pub reason: String,
}

/// Marker-carrying file that is not a generated artifact.
#[derive(Debug, Clone, Deserialize)]
pub struct MarkerExemption {
    /// Glob relative to the repo root.
    pub pattern: String,
    /// Why this file may mention the marker without being generated output.
    pub reason: String,
}

/// Artifact owned by an external toolchain (not dto-gen).
#[derive(Debug, Clone, Deserialize)]
pub struct ExternalGeneratedEntry {
    /// Stable id used by tests and the runner.
    pub id: String,
    /// Repo-root-relative paths this toolchain writes.
    pub paths: Vec<String>,
    /// Shell command that reproduces `paths`.
    pub generator: String,
    /// Directory the generator runs in, repo-root-relative.
    pub cwd: Option<String>,
    /// Marker substring required in every text path; `None` when unmarkable.
    pub marker: Option<String>,
    /// `gitDiff` (in-place) or `command` (self-check).
    #[serde(default = "default_verify")]
    pub verify: String,
    /// Self-check command, required when `verify` is `command`.
    #[serde(rename = "verifyCommand")]
    pub verify_command: Option<String>,
    /// Binary: skip marker, use the sha256 registry.
    #[serde(default)]
    pub binary: bool,
    /// Output is not bit-stable across hosts — drift warns instead of failing.
    #[serde(rename = "nonDeterministic", default)]
    pub non_deterministic: bool,
    /// Substrings that must not appear.
    #[serde(rename = "forbidPatterns", default)]
    pub forbid_patterns: Vec<ForbidPattern>,
}

/// Default `verify` mode when the YAML omits it (`gitDiff`).
fn default_verify() -> String {
    "gitDiff".to_string()
}

/// One dto-gen / drift artifact from the `generated:` list.
#[derive(Debug, Clone, Deserialize)]
pub struct GeneratedEntry {
    /// Stable id used by tests and lookup helpers.
    pub id: String,
    /// Repo-root-relative path (dto-gen `--flag` target, or drift-only file).
    pub path: String,
    /// dto-gen flag, when this artifact is emitted explicitly.
    pub flag: Option<String>,
    /// Alternate drift path (crate dir instead of `src/`).
    #[serde(rename = "driftPath")]
    pub drift_path: Option<String>,
    /// Expanded drift files when `path` is a directory of generated sources.
    #[serde(rename = "driftPaths")]
    pub drift_paths: Option<Vec<String>>,
}

/// Flagged or unflagged contract input.
#[derive(Debug, Clone, Deserialize)]
pub struct FlaggedPath {
    /// Repo-root-relative path.
    pub path: String,
    /// Optional dto-gen flag.
    pub flag: Option<String>,
}

/// Deserialized `repo-paths.yaml` document.
#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    /// Schema version (must be 1).
    pub version: u32,
    /// Top-level directory names relative to the repo root.
    pub dirs: BTreeMap<String, String>,
    /// Language / binding surface directories.
    pub sdks: BTreeMap<String, String>,
    /// Published TypeScript SDK packages.
    #[serde(rename = "tsPackages")]
    pub ts_packages: BTreeMap<String, String>,
    /// User-facing tool packages (CLI, scaffolder, init).
    #[serde(rename = "toolPackages")]
    pub tool_packages: BTreeMap<String, String>,
    /// Internal TypeScript packages (not published).
    #[serde(rename = "internalPackages")]
    pub internal_packages: BTreeMap<String, String>,
    /// OpenAPI snapshot, contract manifest, fixture trees.
    #[serde(rename = "contractInputs")]
    pub contract_inputs: BTreeMap<String, FlaggedPath>,
    /// Generated artifacts (dto-gen flag order, plus drift-only entries).
    pub generated: Vec<GeneratedEntry>,
    /// Ordered generated ids matching today's `GENERATED_PATHS`.
    pub drift: Vec<String>,
    /// Artifacts owned by external toolchains, not dto-gen.
    #[serde(rename = "externalGenerated", default)]
    pub external_generated: Vec<ExternalGeneratedEntry>,
    /// `shasum -a 256` registry for binary artifacts.
    #[serde(rename = "sha256Registry", default)]
    pub sha256_registry: Option<String>,
    /// Marker-carrying files that are not generated artifacts.
    #[serde(rename = "markerExemptions", default)]
    pub marker_exemptions: Vec<MarkerExemption>,
    /// Extra named paths (live report, fuzz corpus, allowlists).
    #[serde(default)]
    pub lookups: BTreeMap<String, String>,
}

/// Loaded layout: absolute repo root plus the parsed manifest.
#[derive(Debug, Clone)]
pub struct RepoPaths {
    /// Absolute monorepo root.
    root: PathBuf,
    /// Parsed YAML document.
    manifest: Manifest,
}

impl RepoPaths {
    /// Absolute monorepo root.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Parsed manifest.
    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    /// Join a repo-root-relative posix path onto the root.
    pub fn abs(&self, rel: &str) -> PathBuf {
        let mut out = self.root.clone();
        for part in rel.split('/') {
            if !part.is_empty() {
                out.push(part);
            }
        }
        out
    }

    /// `contract/fixtures`.
    pub fn contract_fixtures(&self) -> Result<PathBuf> {
        self.contract_input("fixtures")
    }

    /// `contract/fixtures/client`.
    pub fn client_fixtures(&self) -> Result<PathBuf> {
        self.contract_input("clientFixtures")
    }

    /// Absolute path for a `contractInputs` key.
    pub fn contract_input(&self, key: &str) -> Result<PathBuf> {
        let entry = self
            .manifest
            .contract_inputs
            .get(key)
            .ok_or_else(|| RepoPathsError::UnknownContractInput(key.to_owned()))?;
        Ok(self.abs(&entry.path))
    }

    /// Absolute path for a `generated` id (`path`, not drift expansion).
    pub fn generated_path(&self, id: &str) -> Result<PathBuf> {
        let entry = self
            .manifest
            .generated
            .iter()
            .find(|item| item.id == id)
            .ok_or_else(|| RepoPathsError::UnknownGenerated(id.to_owned()))?;
        Ok(self.abs(&entry.path))
    }

    /// Absolute directory for a published TypeScript SDK package.
    pub fn ts_package(&self, id: &str) -> Result<PathBuf> {
        self.package_dir("ts", &self.manifest.ts_packages, id)
    }

    /// Absolute directory for a user-facing tool package.
    pub fn tool_package(&self, id: &str) -> Result<PathBuf> {
        self.package_dir("tool", &self.manifest.tool_packages, id)
    }

    /// Absolute directory for an internal TypeScript package.
    pub fn internal_package(&self, id: &str) -> Result<PathBuf> {
        self.package_dir("internal", &self.manifest.internal_packages, id)
    }

    /// Resolve a package id from a kind-tagged relative-path map.
    fn package_dir(&self, kind: &str, map: &BTreeMap<String, String>, id: &str) -> Result<PathBuf> {
        let rel = map.get(id).ok_or_else(|| RepoPathsError::UnknownPackage {
            kind: kind.to_owned(),
            id: id.to_owned(),
        })?;
        Ok(self.abs(rel))
    }

    /// Absolute path for a `lookups` key.
    pub fn lookup(&self, key: &str) -> Result<PathBuf> {
        let rel = self
            .manifest
            .lookups
            .get(key)
            .ok_or_else(|| RepoPathsError::UnknownLookup(key.to_owned()))?;
        Ok(self.abs(rel))
    }

    /// Ids of every `generated` entry, in manifest order.
    pub fn generated_ids(&self) -> Vec<&str> {
        self.manifest
            .generated
            .iter()
            .map(|item| item.id.as_str())
            .collect()
    }
}

/// Load the layout manifest, discovering the repo root from this crate.
pub fn load() -> Result<RepoPaths> {
    load_from(&try_repo_root()?)
}

/// Load the layout manifest given an already-resolved repo root.
pub fn load_from(root: &Path) -> Result<RepoPaths> {
    let path = {
        let mut p = root.to_path_buf();
        for part in MANIFEST_REL.split('/') {
            p.push(part);
        }
        p
    };
    let raw = fs::read_to_string(&path).map_err(|source| RepoPathsError::Io {
        path: path.clone(),
        source,
    })?;
    let manifest: Manifest = serde_norway::from_str(&raw).map_err(|err| RepoPathsError::Parse {
        path: path.clone(),
        message: err.to_string(),
    })?;
    if manifest.version != 1 {
        return Err(RepoPathsError::Parse {
            path,
            message: format!("unsupported repo-paths version {}", manifest.version),
        });
    }
    Ok(RepoPaths {
        root: root.to_path_buf(),
        manifest,
    })
}
