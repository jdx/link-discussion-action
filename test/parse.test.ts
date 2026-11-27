import { describe, it, expect } from 'vitest'
import { parseDiscussionRefs } from '../src/parse'

describe('parseDiscussionRefs', () => {
  it('parses closing keyword', () => {
    expect(parseDiscussionRefs('Closes #42')).toEqual([{ number: 42, shouldClose: true }])
  })

  it('parses fix keyword', () => {
    expect(parseDiscussionRefs('Fix #42')).toEqual([{ number: 42, shouldClose: true }])
  })

  it('parses resolve keyword', () => {
    expect(parseDiscussionRefs('Resolved #42')).toEqual([{ number: 42, shouldClose: true }])
  })

  it('accepts discussion prefix', () => {
    expect(parseDiscussionRefs('Fixes discussion #42')).toEqual([
      { number: 42, shouldClose: true },
    ])
  })

  it('treats ref keyword as reference only', () => {
    expect(parseDiscussionRefs('Refs #42')).toEqual([{ number: 42, shouldClose: false }])
  })

  it('parses "Discussion: #N" form', () => {
    expect(parseDiscussionRefs('Discussion: #42')).toEqual([
      { number: 42, shouldClose: false },
    ])
  })

  it('closing takes precedence over reference for same number', () => {
    const refs = parseDiscussionRefs('Refs #42\n\nCloses #42')
    expect(refs).toEqual([{ number: 42, shouldClose: true }])
  })

  it('parses multiple refs', () => {
    const refs = parseDiscussionRefs('Closes #1\nFixes #2\nRefs #3\nDiscussion: #4')
    expect(refs.sort((a, b) => a.number - b.number)).toEqual([
      { number: 1, shouldClose: true },
      { number: 2, shouldClose: true },
      { number: 3, shouldClose: false },
      { number: 4, shouldClose: false },
    ])
  })

  it('returns empty when no refs', () => {
    expect(parseDiscussionRefs('Just a regular PR description')).toEqual([])
  })

  it('is case insensitive', () => {
    expect(parseDiscussionRefs('CLOSES #42')).toEqual([{ number: 42, shouldClose: true }])
  })

  it('parses refs inline in a sentence', () => {
    const refs = parseDiscussionRefs('This PR closes #42 and also fixes #43.')
    expect(refs.sort((a, b) => a.number - b.number)).toEqual([
      { number: 42, shouldClose: true },
      { number: 43, shouldClose: true },
    ])
  })

  it('does not match plain numbers without #', () => {
    expect(parseDiscussionRefs('See issue 42')).toEqual([])
  })

  describe('full URL references', () => {
    const ctx = { owner: 'jdx', repo: 'fnox' }

    it('closes a same-repo discussion URL', () => {
      expect(
        parseDiscussionRefs('Fixes https://github.com/jdx/fnox/discussions/1233', ctx),
      ).toEqual([{ number: 1233, shouldClose: true }])
    })

    it('closes a same-repo issue URL', () => {
      expect(parseDiscussionRefs('Closes https://github.com/jdx/fnox/issues/7', ctx)).toEqual([
        { number: 7, shouldClose: true },
      ])
    })

    it('matches owner and repo case-insensitively', () => {
      expect(
        parseDiscussionRefs('Resolves https://github.com/JDX/Fnox/discussions/5', ctx),
      ).toEqual([{ number: 5, shouldClose: true }])
    })

    it('ignores URLs for a different repository', () => {
      expect(
        parseDiscussionRefs(
          'Fixes https://github.com/jdx/mise/discussions/1233\nFixes https://github.com/other/fnox/issues/2',
          ctx,
        ),
      ).toEqual([])
    })

    it('ignores URLs when no repository context is given', () => {
      expect(parseDiscussionRefs('Fixes https://github.com/jdx/fnox/discussions/1')).toEqual([])
    })

    it('treats a reference-keyword URL as comment only', () => {
      expect(parseDiscussionRefs('Refs https://github.com/jdx/fnox/discussions/9', ctx)).toEqual([
        { number: 9, shouldClose: false },
      ])
    })
  })

  describe('colon after closing keyword', () => {
    it('parses "Fixes: #N"', () => {
      expect(parseDiscussionRefs('Fixes: #42')).toEqual([{ number: 42, shouldClose: true }])
    })

    it('parses "Closes : discussion #N"', () => {
      expect(parseDiscussionRefs('Closes : discussion #42')).toEqual([
        { number: 42, shouldClose: true },
      ])
    })

    it('parses "Resolves: URL"', () => {
      expect(
        parseDiscussionRefs('Resolves: https://github.com/jdx/fnox/discussions/3', {
          owner: 'jdx',
          repo: 'fnox',
        }),
      ).toEqual([{ number: 3, shouldClose: true }])
    })
  })

  describe('non-live text is ignored', () => {
    it('ignores HTML comments', () => {
      expect(parseDiscussionRefs('<!-- Fixes #1 -->\nDone.')).toEqual([])
    })

    it('ignores multi-line HTML comments', () => {
      expect(parseDiscussionRefs('<!--\nTemplate:\nCloses #1\n-->')).toEqual([])
    })

    it('ignores backtick fenced code blocks', () => {
      expect(parseDiscussionRefs('Example:\n```\nFixes #1\n```\nCloses #2')).toEqual([
        { number: 2, shouldClose: true },
      ])
    })

    it('ignores tilde fenced code blocks', () => {
      expect(parseDiscussionRefs('~~~md\nFixes #1\n~~~')).toEqual([])
    })

    it('keeps a longer fence open across a shorter inner fence', () => {
      const body = '````md\n```\nx\n```\nFixes #1\n````\nFixes #2'
      expect(parseDiscussionRefs(body)).toEqual([{ number: 2, shouldClose: true }])
    })

    it('ignores inline code', () => {
      expect(parseDiscussionRefs('Write `Fixes #1` or ``Closes #2`` in the body.')).toEqual([])
    })

    it('ignores indented code', () => {
      expect(parseDiscussionRefs('Example:\n\n    Fixes #1\n\tCloses #2')).toEqual([])
    })

    it('ignores block quotes', () => {
      expect(parseDiscussionRefs('> Fixes #1\n  > Refs #2\nCloses #3')).toEqual([
        { number: 3, shouldClose: true },
      ])
    })
  })
})
