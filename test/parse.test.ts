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
})
