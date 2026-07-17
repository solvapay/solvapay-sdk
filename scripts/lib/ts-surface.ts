/**
 * TypeScript surface reader for parity checks (Compiler API).
 *
 * Enumerates named exports from package entry points and method names on
 * `SolvaPayClient` without adding a ts-morph dependency.
 */

import path from 'node:path'
import ts from 'typescript'

export interface TsSurface {
  portableExports: Set<string>
  clientMethods: Set<string>
  facadeMethods: Set<string>
}

function loadProgram(entryFiles: string[], compilerOptions: ts.CompilerOptions): ts.Program {
  return ts.createProgram(entryFiles, {
    ...compilerOptions,
    noEmit: true,
    skipLibCheck: true,
  })
}

function namedExportsOf(program: ts.Program, filePath: string): Set<string> {
  const checker = program.getTypeChecker()
  const sf = program.getSourceFile(filePath)
  const out = new Set<string>()
  if (sf === undefined) {
    return out
  }
  const symbol = checker.getSymbolAtLocation(sf)
  if (symbol === undefined) {
    // Fall back to walking export declarations when the file isn't a module symbol.
    for (const stmt of sf.statements) {
      if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          out.add(el.name.text)
        }
      }
      if (
        (ts.isFunctionDeclaration(stmt) ||
          ts.isClassDeclaration(stmt) ||
          ts.isInterfaceDeclaration(stmt) ||
          ts.isTypeAliasDeclaration(stmt) ||
          ts.isVariableStatement(stmt)) &&
        stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        if (ts.isVariableStatement(stmt)) {
          for (const decl of stmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              out.add(decl.name.text)
            }
          }
        } else if (stmt.name !== undefined) {
          out.add(stmt.name.text)
        }
      }
    }
    return out
  }
  for (const exp of checker.getExportsOfModule(symbol)) {
    out.add(exp.getName())
  }
  return out
}

function interfaceMethodsOf(
  program: ts.Program,
  filePath: string,
  interfaceName: string,
): Set<string> {
  const checker = program.getTypeChecker()
  const sf = program.getSourceFile(filePath)
  const out = new Set<string>()
  if (sf === undefined) {
    return out
  }
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      for (const member of node.members) {
        if (
          (ts.isMethodSignature(member) || ts.isPropertySignature(member)) &&
          member.name &&
          ts.isIdentifier(member.name)
        ) {
          out.add(member.name.text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  if (out.size === 0) {
    const mod = checker.getSymbolAtLocation(sf)
    if (mod !== undefined) {
      for (const exp of checker.getExportsOfModule(mod)) {
        if (exp.getName() === interfaceName) {
          const type = checker.getDeclaredTypeOfSymbol(exp)
          for (const prop of type.getProperties()) {
            out.add(prop.getName())
          }
        }
      }
    }
  }
  return out
}

/**
 * Read portable exports from `@solvapay/server` + `@solvapay/core` source entry
 * points and `SolvaPayClient` methods from `client.ts`.
 */
export function readTsSurface(repoRoot: string): TsSurface {
  const serverEntry = path.join(repoRoot, 'packages/server/src/index.ts')
  const coreEntry = path.join(repoRoot, 'packages/core/src/index.ts')
  const clientFile = path.join(repoRoot, 'packages/server/src/types/client.ts')
  const factoryFile = path.join(repoRoot, 'packages/server/src/factory.ts')

  const configPath = ts.findConfigFile(
    path.join(repoRoot, 'packages/server'),
    ts.sys.fileExists,
    'tsconfig.json',
  )
  const config = configPath
    ? ts.parseJsonConfigFileContent(
        ts.readConfigFile(configPath, ts.sys.readFile).config,
        ts.sys,
        path.dirname(configPath),
      )
    : {
        options: {
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          strict: true,
        },
      }

  const program = loadProgram(
    [serverEntry, coreEntry, clientFile, factoryFile],
    config.options,
  )
  const portableExports = new Set<string>([
    ...namedExportsOf(program, serverEntry),
    ...namedExportsOf(program, coreEntry),
  ])
  const clientMethods = interfaceMethodsOf(program, clientFile, 'SolvaPayClient')
  const facadeMethods = new Set<string>([
    ...interfaceMethodsOf(program, factoryFile, 'SolvaPay'),
    // `gate` / adapters live on PayableFunction returned by `payable()`
    ...interfaceMethodsOf(program, factoryFile, 'PayableFunction'),
  ])
  // `protect` is exposed via createPaywall() return shape in paywall.ts
  const paywallFile = path.join(repoRoot, 'packages/server/src/paywall.ts')
  for (const name of interfaceMethodsOf(program, paywallFile, 'SolvaPayPaywall')) {
    facadeMethods.add(name)
  }
  // Also accept protect from the createPaywall closure exports (function name).
  if (portableExports.has('createPaywall') || facadeMethods.has('protect')) {
    facadeMethods.add('protect')
  }
  // Heuristic: protect is a well-known facade entry even when only present as
  // a method on the paywall instance type inferred from implementation.
  const paywallSf = program.getSourceFile(paywallFile)
  if (paywallSf !== undefined && /async protect</.test(paywallSf.text)) {
    facadeMethods.add('protect')
  }
  return { portableExports, clientMethods, facadeMethods }
}
