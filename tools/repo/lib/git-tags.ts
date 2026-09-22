import { execFileSync } from 'node:child_process'
import { REPO_ROOT } from '../../shared/paths.js'

export function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
}

export function parseRemoteTagNames(lsRemoteOutput: string): string[] {
  return lsRemoteOutput
    .split('\n')
    .map(line => {
      const match = line.match(/refs\/tags\/(\S+)/)
      return match?.[1]?.replace(/\^\{\}$/, '') ?? ''
    })
    .filter(Boolean)
}

export function listRemoteTagNames(): string[] {
  return parseRemoteTagNames(git(['ls-remote', '--tags', 'origin']))
}

export function localTagExists(tag: string): boolean {
  try {
    git(['show-ref', '--verify', '--quiet', `refs/tags/${tag}`])
    return true
  } catch {
    return false
  }
}

export function pushTagsAtHead(tags: readonly string[]): void {
  const sha = git(['rev-parse', 'HEAD'])
  for (const tag of tags) {
    git(['tag', tag, sha])
    git(['push', 'origin', `refs/tags/${tag}`])
    console.log(`pushed ${tag} -> ${sha}`)
  }
}
