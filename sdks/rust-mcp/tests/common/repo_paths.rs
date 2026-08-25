use repo_paths::load;

pub fn lookup_mcp_fixtures() -> std::path::PathBuf {
    load()
        .expect("load repo-paths")
        .lookup("mcpFixtures")
        .expect("mcpFixtures lookup")
}
