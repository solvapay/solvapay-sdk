---
'@solvapay/init': minor
'solvapay': patch
---

`solvapay doctor` now checks that the project's installed `@solvapay/*` packages match npm: `latest`, or `preview` for a preview build. When any is behind, the check fails and prints the exact upgrade command for the project's package manager. A declared package that isn't installed, or a registry lookup that fails, also fails the check. `@solvapay/init` exports the check (`findOutdatedSolvapayPackages`, `solvapayDependencies`, `upgradeCommand`, `compareStable`).
