/**
 * Whether a CLI version is a preview build (`1.5.0-preview-<sha>`, published
 * to npm's `preview` tag on every push to dev). A preview CLI installs and
 * pins preview SDKs; a stable CLI, stable SDKs.
 */
export const isPreviewBuild = (version: string): boolean => /-preview\b/.test(version)
