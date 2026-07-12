import * as core from '@actions/core'
import * as github from '@actions/github'
import { parseDiscussionRefs } from './parse'

const GET_DISCUSSION = /* GraphQL */ `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      discussion(number: $number) {
        id
        number
        title
        url
        closed
      }
    }
  }
`

const ADD_COMMENT = /* GraphQL */ `
  mutation($discussionId: ID!, $body: String!) {
    addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
      comment { url }
    }
  }
`

const CLOSE_DISCUSSION = /* GraphQL */ `
  mutation($discussionId: ID!, $reason: DiscussionCloseReason!) {
    closeDiscussion(input: { discussionId: $discussionId, reason: $reason }) {
      discussion { url }
    }
  }
`

interface Discussion {
  id: string
  number: number
  title: string
  url: string
  closed: boolean
}

interface GetDiscussionResult {
  repository: { discussion: Discussion | null } | null
}

async function run(): Promise<void> {
  const token = core.getInput('github-token', { required: true })
  const octokit = github.getOctokit(token)

  const { owner, repo } = github.context.repo
  const pr = github.context.payload.pull_request

  if (!pr) {
    core.setFailed('This action must run on pull_request events.')
    return
  }

  if (!pr.merged) {
    core.info('Pull request was not merged, nothing to do.')
    return
  }

  const body = (pr.body as string | null) ?? ''
  const refs = parseDiscussionRefs(body)

  if (refs.length === 0) {
    core.info('No discussion references found in PR body.')
    return
  }

  core.info(`Found ${refs.length} reference(s): ${refs.map(r => `#${r.number}`).join(', ')}`)

  const prNumber = pr.number as number
  const prTitle = pr.title as string
  const prUrl = pr.html_url as string
  const commentBody = `Implemented in [#${prNumber}](${prUrl}): ${prTitle}`

  for (const ref of refs) {
    try {
      const result = (await octokit.graphql(GET_DISCUSSION, {
        owner,
        repo,
        number: ref.number,
      })) as GetDiscussionResult

      const discussion = result.repository?.discussion
      if (!discussion) {
        core.info(
          `#${ref.number} is not a discussion, skipping (GitHub handles issue linking natively).`,
        )
        continue
      }

      await octokit.graphql(ADD_COMMENT, { discussionId: discussion.id, body: commentBody })
      core.info(`Commented on discussion #${ref.number}`)

      if (ref.shouldClose && !discussion.closed) {
        await octokit.graphql(CLOSE_DISCUSSION, {
          discussionId: discussion.id,
          reason: 'RESOLVED',
        })
        core.info(`Closed discussion #${ref.number} (reason: RESOLVED)`)
      } else if (ref.shouldClose && discussion.closed) {
        core.info(`Discussion #${ref.number} already closed, skipping close.`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      core.warning(`Failed to process #${ref.number}: ${msg}`)
    }
  }
}

run().catch(err => {
  core.setFailed(err instanceof Error ? err.message : String(err))
})
