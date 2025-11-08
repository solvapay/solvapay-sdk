# Documentation Standards

## 3.1. JSDoc Comment Format

All exported functions, classes, and interfaces must include JSDoc comments with:

````typescript
/**
 * Brief description (one line)
 *
 * Longer description if needed, explaining what the function does,
 * when to use it, and any important considerations.
 *
 * @param paramName - Parameter description
 * @param options - Optional configuration object
 * @param options.key - Option key description
 * @returns Return value description
 * @throws {ErrorType} When and why this error is thrown
 *
 * @example
 * ```typescript
 * // Simple example
 * const result = await myFunction('param');
 * ```
 *
 * @example
 * ```typescript
 * // Advanced example with options
 * const result = await myFunction('param', {
 *   key: 'value'
 * });
 * ```
 *
 * @see {@link RelatedFunction} for related functionality
 * @since 1.0.0
 */
````

## 3.2. Code Example Standards

All code examples should:

- ✅ Be **copy-paste ready** (no pseudo-code)
- ✅ Include **import statements**
- ✅ Show **error handling** where relevant
- ✅ Use **realistic variable names** (`agentRef`, `customerRef`, not `foo`, `bar`)
- ✅ Include **environment variable examples** where relevant
- ✅ Show **best practices** (not just "it works")
- ✅ Include **TypeScript types** explicitly when helpful
- ✅ Show **complete examples** (not just snippets where context is needed)

## 3.3. Documentation Metadata

Each package should have:

- **Package-level README** with overview and quick start
- **Version information** in generated docs
- **Changelog links** for version history
- **Migration guides** for breaking changes

## 3.4. Documentation Maintenance

### Regular Updates

- **After each release**: Review and update examples, check for breaking changes
- **Periodic audits**: Audit documentation for accuracy, update outdated examples
- **Regular reviews**: Review documentation structure, add new guides based on user feedback

### Quality Checks

- **Automated**: TypeDoc validation, link checking, code example linting
- **Manual**: Peer review for new documentation, user feedback collection

### Versioning Strategy

- **Current version**: Always up-to-date with latest code
- **Previous versions**: Archive older versions if breaking changes occur
- **Preview versions**: Document preview features separately
