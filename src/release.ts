import * as core from '@actions/core'

type Octokit = { rest: any; graphql: (query: string, variables: Record<string, unknown>) => Promise<any> }

const SQUASH_PR = /\(#(\d+)\)\s*$/
const CLOSING_REF = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+(?:discussion\s+)?#(\d+)\b/gi
const BOT_LOGINS = new Set(['github-actions', 'github-actions[bot]'])

const PR_QUERY = `query($owner:String!,$repo:String!,$number:Int!,$cursor:String) {
  repository(owner:$owner,name:$repo) { pullRequest(number:$number) { body closingIssuesReferences(first:100,after:$cursor) {
    pageInfo { hasNextPage endCursor } nodes { number state repository { nameWithOwner } }
  } } }
}`
const DISCUSSION_QUERY = `query($owner:String!,$repo:String!,$number:Int!,$cursor:String) {
  repository(owner:$owner,name:$repo) { discussion(number:$number) { id closed comments(first:100,after:$cursor) {
    pageInfo { hasNextPage endCursor } nodes { body author { login } }
  } } }
}`
const ADD_DISCUSSION_COMMENT = `mutation($id:ID!,$body:String!) { addDiscussionComment(input:{discussionId:$id,body:$body}) { comment { id } } }`

export function stripNoise(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '')
}

function boolInput(name: string): boolean { return core.getInput(name).toLowerCase() === 'true' }
function marker(prefix: string, tag: string): string { return `<!-- ${prefix}:${tag} -->` }

export async function stableReleasesAfter(octokit: Octokit, owner: string, repo: string, tag: string): Promise<string[]> {
  let found = false
  const after: string[] = []
  for (let page = 1; after.length < 10; page += 1) {
    const { data } = await octokit.rest.repos.listReleases({ owner, repo, per_page: 100, page })
    if (!data.length) break
    for (const release of data) {
      if (release.draft || release.prerelease) continue
      if (release.tag_name === tag) found = true
      else if (found) after.push(release.tag_name)
    }
  }
  if (!found) throw new Error(`${tag} is not a stable published release`)
  return after.slice(0, 10)
}

export async function previousRelease(octokit: Octokit, owner: string, repo: string, tag: string): Promise<string> {
  let best: { tag: string; ahead: number } | undefined
  for (const candidate of await stableReleasesAfter(octokit, owner, repo, tag)) {
    try {
      const { data } = await octokit.rest.repos.compareCommits({ owner, repo, base: candidate, head: tag, per_page: 1 })
      if (data.status === 'ahead' && (!best || data.ahead_by < best.ahead)) best = { tag: candidate, ahead: data.ahead_by }
    } catch (err: any) {
      if (err?.status === 404) { core.warning(`could not compare ${candidate}...${tag}: tag not found`); continue }
      throw err
    }
  }
  if (!best) throw new Error(`no earlier release found that ${tag} contains`)
  return best.tag
}

async function releasePrs(octokit: Octokit, owner: string, repo: string, base: string, tag: string): Promise<number[]> {
  const { data } = await octokit.rest.repos.compareCommits({ owner, repo, base, head: tag, per_page: 250 })
  const prs = new Set<number>()
  for (const commit of data.commits) {
    const match = SQUASH_PR.exec(commit.commit.message.split('\n', 1)[0])
    if (match) prs.add(Number(match[1]))
  }
  return [...prs]
}

export async function prTargets(octokit: Octokit, owner: string, repo: string, pr: number): Promise<{ issues: number[]; discussions: number[] }> {
  let cursor: string | null = null
  let body = ''
  const refs: any[] = []
  do {
    const data = await octokit.graphql(PR_QUERY, { owner, repo, number: pr, cursor })
    const pull = data.repository?.pullRequest
    if (!pull) throw new Error(`pull request #${pr} was not found`)
    body = pull.body || body
    refs.push(...pull.closingIssuesReferences.nodes)
    cursor = pull.closingIssuesReferences.pageInfo.hasNextPage ? pull.closingIssuesReferences.pageInfo.endCursor : null
  } while (cursor)
  const qualified = `${owner}/${repo}`
  const issues = new Set<number>(refs.filter(ref => ref.state === 'CLOSED' && ref.repository?.nameWithOwner === qualified).map(ref => ref.number))
  const discussions = new Set<number>()
  for (const match of stripNoise(body).matchAll(CLOSING_REF)) if (!issues.has(Number(match[1]))) discussions.add(Number(match[1]))
  return { issues: [...issues], discussions: [...discussions] }
}

async function discussion(octokit: Octokit, owner: string, repo: string, number: number): Promise<any | undefined> {
  let cursor: string | null = null
  const comments: any[] = []
  let found: any
  do {
    const data = await octokit.graphql(DISCUSSION_QUERY, { owner, repo, number, cursor })
    found = data.repository?.discussion
    if (!found) return undefined
    comments.push(...found.comments.nodes)
    cursor = found.comments.pageInfo.hasNextPage ? found.comments.pageInfo.endCursor : null
  } while (cursor)
  return { ...found, comments }
}

async function commentDiscussion(octokit: Octokit, owner: string, repo: string, number: number, tag: string, pr: number, prefix: string, upgradeText: string, dryRun: boolean): Promise<'commented' | 'skipped'> {
  const item = await discussion(octokit, owner, repo, number)
  if (!item) return 'skipped'
  if (!item.closed) { core.info(`skip discussion #${number}: still open`); return 'skipped' }
  const mark = marker(prefix, tag)
  if (item.comments.some((comment: any) => BOT_LOGINS.has(comment.author?.login) && comment.body?.includes(mark))) {
    core.info(`skip discussion #${number}: already commented for ${tag}`); return 'skipped'
  }
  const body = `${mark}\nFixed in [${tag}](https://github.com/${owner}/${repo}/releases/tag/${tag}) by #${pr}.${upgradeText ? ` ${upgradeText}` : ''}`
  if (dryRun) { core.info(`[dry run] would comment on discussion #${number} (from #${pr})`); return 'commented' }
  await octokit.graphql(ADD_DISCUSSION_COMMENT, { id: item.id, body })
  core.info(`commented on discussion #${number} (from #${pr})`)
  return 'commented'
}

export async function runRelease({ octokit, owner, repo }: { octokit: Octokit; owner: string; repo: string }): Promise<void> {
  const tag = core.getInput('tag', { required: true })
  const pattern = new RegExp(core.getInput('tag-pattern') || '^v[0-9][0-9A-Za-z._+-]*$')
  if (!pattern.test(tag)) throw new Error(`tag ${tag} does not match tag-pattern`)
  const prefix = core.getInput('marker-prefix') || 'fixed-in'
  const upgradeText = core.getInput('upgrade-text')
  const dryRun = boolInput('dry-run')
  const base = await previousRelease(octokit, owner, repo, tag)
  const prs = await releasePrs(octokit, owner, repo, base, tag)
  core.info(`${tag}: ${prs.length} PRs since ${base}`)
  const failures: string[] = []
  for (const pr of prs) {
    try {
      const targets = await prTargets(octokit, owner, repo, pr)
      for (const issue of targets.issues) {
        try {
          if (dryRun) core.info(`[dry run] would comment on issue #${issue} (from #${pr})`)
          else await octokit.rest.issues.createComment({ owner, repo, issue_number: issue, body: `${marker(prefix, tag)}\nFixed in [${tag}](https://github.com/${owner}/${repo}/releases/tag/${tag}) by #${pr}.${upgradeText ? ` ${upgradeText}` : ''}` })
        } catch (err: any) { failures.push(`issue #${issue} from #${pr}: ${err.message || err}`) }
      }
      for (const number of targets.discussions) {
        try { await commentDiscussion(octokit, owner, repo, number, tag, pr, prefix, upgradeText, dryRun) }
        catch (err: any) { failures.push(`discussion #${number} from #${pr}: ${err.message || err}`) }
      }
    } catch (err: any) { failures.push(`read #${pr}: ${err.message || err}`) }
  }
  if (failures.length) throw new Error(`release notification failures:\n${failures.join('\n')}`)
}
