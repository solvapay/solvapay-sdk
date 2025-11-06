# Documentation Tool Selection

## Recommended Solution: **TypeDoc + Docusaurus**

After evaluating modern documentation generators, we recommend a **hybrid approach**:

### Primary Tool: **TypeDoc** (v0.25+)
- ✅ **TypeScript-native**: Specifically designed for TypeScript projects
- ✅ **JSDoc Integration**: Automatically extracts JSDoc comments from source code
- ✅ **Type Safety**: Shows accurate type information from TypeScript definitions
- ✅ **Modern Themes**: Supports custom themes (e.g., `typedoc-plugin-markdown`, `typedoc-vitepress-theme`)
- ✅ **CI/CD Ready**: Easy to integrate into build pipelines
- ✅ **Active Development**: Well-maintained with regular updates

### Documentation Site Framework: **Docusaurus v3** (Optional but Recommended)
- ✅ **Modern UI**: Beautiful, responsive design out of the box
- ✅ **Search**: Built-in Algolia DocSearch integration
- ✅ **Versioning**: Support for multiple SDK versions
- ✅ **Guides + API**: Combine getting started guides with auto-generated API docs
- ✅ **TypeDoc Plugin**: `docusaurus-plugin-typedoc` for seamless integration
- ✅ **Markdown Support**: Easy to write guides and tutorials alongside API docs

**Alternative (Simpler)**: If you prefer a simpler setup, TypeDoc alone with a custom theme (like `typedoc-plugin-markdown` + static site generator) works great.

## Python SDK Documentation Tools

**Important Note:** TypeDoc is **TypeScript/JavaScript-specific** and does not support Python. For Python SDK documentation, use Python-native tools:

### Recommended: **Sphinx** (for Python SDK)

**Why Sphinx:**
- ✅ **Python-native**: Standard tool for Python documentation (used by Python.org, Django, etc.)
- ✅ **Docstring Integration**: Automatically extracts docstrings from Python code
- ✅ **reStructuredText or Markdown**: Supports both formats
- ✅ **Rich Output**: HTML, PDF, ePub formats
- ✅ **Extensible**: Large plugin ecosystem
- ✅ **CI/CD Ready**: Easy to integrate into build pipelines

### Alternative: MkDocs (Simpler option)
- ✅ **Markdown-based**: Easier to write than reStructuredText
- ✅ **Material theme**: Modern, beautiful default theme
- ✅ **Plugin support**: Extensible with plugins
- ✅ **Simpler setup**: Less configuration than Sphinx

### Integration with Docusaurus

Since Docusaurus accepts markdown files, Python docs can be integrated in two ways:

1. **Markdown Output**: Generate Python docs as markdown (Sphinx with markdown plugin, or MkDocs)
2. **HTML to Markdown**: Convert Sphinx HTML output to markdown for Docusaurus
3. **Direct Markdown**: Write Python API docs manually in markdown (simpler but less automated)

**Recommended Approach for Python:**
- Use **MkDocs** to generate markdown from Python docstrings
- Or use **Sphinx** with markdown support
- Output markdown files to `docs/` directory in Python SDK repo
- Docusaurus will automatically include them via git submodules

## Installation & Setup

```bash
# Core TypeDoc dependencies
pnpm add -D typedoc typedoc-plugin-markdown typedoc-plugin-param-names

# Optional: Docusaurus for full documentation site
pnpm add -D docusaurus @docusaurus/plugin-typedoc

# Or simpler: TypeDoc with Vitepress theme
pnpm add -D typedoc typedoc-vitepress-theme
```

## Recommended Tools & Plugins

### TypeDoc Plugins
- `typedoc-plugin-markdown` - Generate Markdown output
- `typedoc-plugin-param-names` - Better parameter name extraction
- `typedoc-plugin-no-inherit` - Control inheritance display
- `typedoc-plugin-sourcefile-url` - Add source file links

### Documentation Site Options
1. **TypeDoc Default Theme** - Simple, fast, TypeScript-focused
2. **Docusaurus** - Full-featured docs site with search, versioning
3. **VitePress** - Fast, Vue-based docs site
4. **GitBook** - Modern docs platform (hosted option)

### Additional Tools
- **Link Checker**: `remark-cli` with `remark-lint` for markdown validation
- **Code Example Testing**: Automated tests for code examples
- **Spell Checker**: `cspell` for documentation spelling

