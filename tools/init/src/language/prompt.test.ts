import { describe, expect, it } from 'vitest'
import { languageChoiceEntries } from './prompt'

describe('languageChoiceEntries', () => {
  it('marks train languages as preview', () => {
    const entries = languageChoiceEntries(['ts', 'python', 'go'])
    expect(entries).toEqual([
      { id: 'ts', label: 'TypeScript' },
      { id: 'python', label: 'Python (preview)' },
      { id: 'go', label: 'Go (preview)' },
    ])
  })
})
