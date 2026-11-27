// GitHub-native linking keywords (closing)
const CLOSING_KEYWORDS = [
  'close', 'closes', 'closed',
  'fix', 'fixes', 'fixed',
  'resolve', 'resolves', 'resolved',
] as const

// Reference keywords (comment only, no close)
const REFERENCE_KEYWORDS = ['ref', 'refs', 'reference', 'references', 'discussion'] as const

// A target is either `#N` or a full issue/discussion URL. URLs only count when
// they point at the repository the action runs in.
const TARGET =
  '(?:(?:https://github\\.com/([\\w.-]+)/([\\w.-]+)/(?:issues|discussions)/([1-9]\\d*))|#([1-9]\\d*))\\b'

export interface ParsedRef {
  number: number
  shouldClose: boolean
}

export interface RepoContext {
  owner: string
  repo: string
}

/**
 * Remove text GitHub does not treat as a live reference: HTML comments, fenced
 * code blocks, inline code, indented code and block quotes. This mirrors
 * `clean` in jdx/workflows' scripts/comment-release-fixes.py, so a discussion
 * mentioned only in an example or a quoted summary is neither closed here nor
 * announced there.
 */
export function stripNonLiveText(body: string): string {
  let text = (body ?? '').replace(/<!--[\s\S]*?-->/g, '')
  // Match the whole opening delimiter so a longer fence cannot be closed by a
  // shorter one inside an example.
  text = text.replace(/^\s*(`{3,})[^\n]*\n[\s\S]*?^\s*\1`*\s*$/gm, '')
  text = text.replace(/^\s*(~{3,})[^\n]*\n[\s\S]*?^\s*\1~*\s*$/gm, '')
  // Inline code spans may use any number of backticks and span lines.
  text = text.replace(/(`+)[\s\S]*?\1/g, '')
  return text
    .split(/\r\n|\r|\n/)
    .filter(line => !/^(?:\s{4}|\t|\s*>)/.test(line))
    .join('\n')
}

function targetNumber(match: RegExpMatchArray, ctx?: RepoContext): number | null {
  const [, owner, repo, urlNum, num] = match
  if (num) return parseInt(num, 10)
  if (
    urlNum &&
    ctx &&
    owner.toLowerCase() === ctx.owner.toLowerCase() &&
    repo.toLowerCase() === ctx.repo.toLowerCase()
  ) {
    return parseInt(urlNum, 10)
  }
  return null
}

/**
 * Parse discussion references from a PR body; closing takes precedence over reference.
 *
 * `ctx` is the repository the PR belongs to. Full-URL references are only
 * accepted when they point at it; without `ctx`, URL references are ignored.
 */
export function parseDiscussionRefs(body: string, ctx?: RepoContext): ParsedRef[] {
  const text = stripNonLiveText(body)
  // number -> shouldClose, deduplicated via Map
  const refs = new Map<number, boolean>()

  // Same grammar as the release-comment script: `Fixes #N`, `Fixes: #N`,
  // `Fixes discussion #N`, `Fixes https://github.com/OWNER/REPO/discussions/N`.
  const closingRe = new RegExp(
    `\\b(?:${CLOSING_KEYWORDS.join('|')})\\s*:?\\s+(?:discussion\\s+)?${TARGET}`,
    'gi',
  )
  for (const match of text.matchAll(closingRe)) {
    const num = targetNumber(match, ctx)
    if (num !== null) refs.set(num, true)
  }

  // Reference semantics (comment only): refs #N, discussion: #N, discussion #N.
  // Closing takes precedence; existing numbers are not overwritten.
  const referenceRe = new RegExp(
    `\\b(?:${REFERENCE_KEYWORDS.join('|')})[:\\s]+${TARGET}`,
    'gi',
  )
  for (const match of text.matchAll(referenceRe)) {
    const num = targetNumber(match, ctx)
    if (num !== null && !refs.has(num)) refs.set(num, false)
  }

  return [...refs.entries()].map(([number, shouldClose]) => ({ number, shouldClose }))
}
