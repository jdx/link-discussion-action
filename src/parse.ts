// GitHub-native linking keywords (closing)
const CLOSING_KEYWORDS = [
  'close', 'closes', 'closed',
  'fix', 'fixes', 'fixed',
  'resolve', 'resolves', 'resolved',
] as const

// Reference keywords (comment only, no close)
const REFERENCE_KEYWORDS = ['ref', 'refs', 'reference', 'references', 'discussion'] as const

export interface ParsedRef {
  number: number
  shouldClose: boolean
}

/** Parse discussion references from a PR body; closing takes precedence over reference. */
export function parseDiscussionRefs(body: string): ParsedRef[] {
  // number -> shouldClose, deduplicated via Map
  const refs = new Map<number, boolean>()

  const closingRe = new RegExp(
    `\\b(?:${CLOSING_KEYWORDS.join('|')})\\s+(?:discussion\\s+)?#(\\d+)`,
    'gi',
  )
  for (const match of body.matchAll(closingRe)) {
    refs.set(parseInt(match[1], 10), true)
  }

  // Reference semantics (comment only): refs #N, discussion: #N, discussion #N.
  // Closing takes precedence; existing numbers are not overwritten.
  const referenceRe = new RegExp(
    `\\b(?:${REFERENCE_KEYWORDS.join('|')})[:\\s]+#(\\d+)`,
    'gi',
  )
  for (const match of body.matchAll(referenceRe)) {
    const num = parseInt(match[1], 10)
    if (!refs.has(num)) refs.set(num, false)
  }

  return [...refs.entries()].map(([number, shouldClose]) => ({ number, shouldClose }))
}
