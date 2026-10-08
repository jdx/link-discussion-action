import { describe, expect, it, vi } from 'vitest'
import { issueAlreadyCommented, prTargets, releasePrs, stableReleasesAfter, stripNoise } from '../src/release'

describe('release notification discovery', () => {
  it('ignores template and code examples and pages closing references', async () => {
    const graphql = vi.fn()
      .mockResolvedValueOnce({ repository: { pullRequest: {
        body: '<!-- Fixes #10 -->\n```\nResolves #11\n```\nFixes discussion #12',
        closingIssuesReferences: { nodes: [{ number: 9, state: 'CLOSED', repository: { nameWithOwner: 'jdx/tool' } }], pageInfo: { hasNextPage: true, endCursor: 'next' } },
      } } })
      .mockResolvedValueOnce({ repository: { pullRequest: {
        body: '', closingIssuesReferences: { nodes: [{ number: 8, state: 'OPEN', repository: { nameWithOwner: 'jdx/tool' } }], pageInfo: { hasNextPage: false, endCursor: null } },
      } } })
    await expect(prTargets({ graphql } as any, 'jdx', 'tool', 7)).resolves.toEqual({ issues: [9], discussions: [12] })
    expect(graphql).toHaveBeenCalledTimes(2)
  })

  it('requires the requested published tag even when release pages are out of order', async () => {
    const listReleases = vi.fn()
      .mockResolvedValueOnce({ data: [
        { tag_name: 'v3', draft: false, prerelease: false },
        { tag_name: 'v2', draft: false, prerelease: false },
        { tag_name: 'v1', draft: false, prerelease: false },
      ] })
      .mockResolvedValueOnce({ data: [] })
    await expect(stableReleasesAfter({ rest: { repos: { listReleases } } } as any, 'jdx', 'tool', 'v2')).resolves.toEqual(['v1'])
    await expect(stableReleasesAfter({ rest: { repos: { listReleases: vi.fn().mockResolvedValue({ data: [] }) } } } as any, 'jdx', 'tool', 'v0')).rejects.toThrow('not a stable published release')
  })

  it('removes HTML comments and fenced code before closing-reference parsing', () => {
    expect(stripNoise('<!-- Fixes #1 -->\n```\nFixes #2\n```\nFixes #3')).toBe('\n\nFixes #3')
  })

  it('pages release commits and deduplicates squash PR subjects', async () => {
    const commits = Array.from({ length: 100 }, (_, i) => ({ commit: { message: `change (#${i + 1})` } }))
    const compareCommits = vi.fn()
      .mockResolvedValueOnce({ data: { commits } })
      .mockResolvedValueOnce({ data: { commits: [{ commit: { message: 'follow up (#100)' } }, { commit: { message: 'not a PR' } }] } })
    await expect(releasePrs({ rest: { repos: { compareCommits } } } as any, 'jdx', 'tool', 'v1', 'v2')).resolves.toHaveLength(100)
    expect(compareCommits).toHaveBeenCalledTimes(2)
  })

  it('recognizes only an Actions-owned marker across paginated issue comments', async () => {
    const comments = Array.from({ length: 100 }, () => ({ user: { login: 'someone' }, body: '<!-- fixed-in:v2 -->' }))
    const listComments = vi.fn()
      .mockResolvedValueOnce({ data: comments })
      .mockResolvedValueOnce({ data: [{ user: { login: 'github-actions[bot]' }, body: '<!-- fixed-in:v2 -->' }] })
    await expect(issueAlreadyCommented({ rest: { issues: { listComments } } } as any, 'jdx', 'tool', 1, '<!-- fixed-in:v2 -->')).resolves.toBe(true)
    expect(listComments).toHaveBeenCalledTimes(2)
  })
})
