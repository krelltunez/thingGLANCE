import { describe, expect, it } from 'vitest'
import { eventLink, formatLink, parseLink, type LinkTarget } from './links'
import { eventTarget as eventTargetOf } from './links'

describe('reading a link', () => {
  it('reads each place the app can be opened at', () => {
    expect(parseLink('thingglance://thing/abc-123')).toEqual({ kind: 'thing', id: 'abc-123' })
    expect(parseLink('thingglance://plan/p1')).toEqual({ kind: 'plan', id: 'p1' })
    expect(parseLink('thingglance://view/horizon')).toEqual({ kind: 'view', view: 'horizon' })
    expect(parseLink('thingglance://queue')).toEqual({ kind: 'queue' })
    expect(parseLink('thingglance://action/add')).toEqual({ kind: 'add', what: 'thing' })
    expect(parseLink('thingglance://action/add-plan')).toEqual({ kind: 'add', what: 'plan' })
    expect(parseLink('thingglance://settings')).toEqual({ kind: 'settings' })
    expect(parseLink('thingglance://settings/household')).toEqual({ kind: 'settings', section: 'household' })
    expect(parseLink('thingglance://search?q=pixel')).toEqual({ kind: 'search', q: 'pixel' })
  })
  it('reads an event key, colons and all', () => {
    const key = 'coverage-end:6f1c:2027-01-15'
    expect(parseLink(`thingglance://event/${encodeURIComponent(key)}`)).toEqual({ kind: 'event', key })
    expect(parseLink(`thingglance://event/${key}`)).toEqual({ kind: 'event', key })
  })
  it('takes a name to prefill when adding', () => {
    expect(parseLink('thingglance://action/add?name=Pixel%209')).toEqual({ kind: 'add', what: 'thing', name: 'Pixel 9' })
  })
  it('accepts the forms the web app is opened with', () => {
    expect(parseLink('web+thingglance://thing/abc')).toEqual({ kind: 'thing', id: 'abc' })
    expect(parseLink('thing/abc')).toEqual({ kind: 'thing', id: 'abc' })
    expect(parseLink('https://things.example.com/?link=thing/abc')).toEqual({ kind: 'thing', id: 'abc' })
    expect(parseLink('?link=' + encodeURIComponent('web+thingglance://view/plans'))).toEqual({ kind: 'view', view: 'plans' })
  })
  it('still reads the query forms the PWA shortcuts were installed with', () => {
    expect(parseLink('?action=add-thing')).toEqual({ kind: 'add', what: 'thing' })
    expect(parseLink('?action=add-subscription')).toEqual({ kind: 'add', what: 'plan' })
    expect(parseLink('?view=horizon')).toEqual({ kind: 'view', view: 'horizon' })
    expect(parseLink('https://things.example.com/?thing=abc')).toEqual({ kind: 'thing', id: 'abc' })
  })
  it('answers null for anything it does not know, instead of guessing', () => {
    for (const bad of ['', '   ', 'thingglance://nowhere', 'thingglance://view/admin', 'thingglance://thing/', 'thingglance://settings/secrets',
      'https://things.example.com/', 'javascript:alert(1)', 'mailto:a@b.c', 'https://things.example.com/?link=https://evil.example', `thingglance://thing/${'x'.repeat(400)}`]) {
      expect(parseLink(bad)).toBeNull()
    }
    expect(parseLink(null)).toBeNull()
    expect(parseLink(undefined)).toBeNull()
  })
  it('has no link that changes anything: there is no action but opening a form', () => {
    for (const link of ['thingglance://action/done', 'thingglance://action/delete', 'thingglance://action/clear', 'thingglance://decide/x', 'thingglance://delete/abc']) {
      expect(parseLink(link)).toBeNull()
    }
  })
})

describe('writing a link', () => {
  const targets: LinkTarget[] = [
    { kind: 'view', view: 'things' }, { kind: 'queue' }, { kind: 'thing', id: 'a b/c' }, { kind: 'plan', id: 'p1' },
    { kind: 'event', key: 'renewal:s1:2026-12-01' }, { kind: 'add', what: 'thing' }, { kind: 'add', what: 'plan', name: 'iCloud+ 2TB' },
    { kind: 'settings' }, { kind: 'settings', section: 'vault' }, { kind: 'search' }, { kind: 'search', q: 'a&b=c' },
  ]
  it('round-trips every target', () => {
    for (const t of targets) expect(parseLink(formatLink(t))).toEqual(t)
  })
  it('writes the canonical scheme', () => {
    expect(formatLink({ kind: 'thing', id: 'abc' })).toBe('thingglance://thing/abc')
    expect(eventLink('renewal:s1:2026-12-01')).toBe('thingglance://event/renewal%3As1%3A2026-12-01')
  })
})

describe('what a date leads to', () => {
  const known = {
    hasThing: (id: string) => id === 't1',
    hasPlan: (id: string) => id === 's1',
    coverageThing: (id: string) => (id === 'c1' ? 't1' : undefined),
  }
  it('opens a plan\'s date on the plan and a thing\'s on the thing', () => {
    expect(eventTargetOf('renewal:s1:2027-01-15', known)).toEqual({ kind: 'plan', id: 's1' })
    expect(eventTargetOf('support-end:t1:2027-01-15', known)).toEqual({ kind: 'thing', id: 't1' })
  })
  it('finds a warranty\'s thing from the key alone, with no date on screen to help', () => {
    // The member filter can hide the date; the reminder for it still opens.
    expect(eventTargetOf('coverage-end:c1:2027-01-15', known)).toEqual({ kind: 'thing', id: 't1' })
    expect(eventTargetOf('coverage-end:c1:2027-01-15', known, null)).toEqual({ kind: 'thing', id: 't1' })
  })
  it('answers nothing for what is not on this device', () => {
    expect(eventTargetOf('coverage-end:hidden:2027-01-15', known)).toBeNull()
    expect(eventTargetOf('renewal:gone:2027-01-15', known)).toBeNull()
    expect(eventTargetOf('nonsense', known)).toBeNull()
  })
  it('prefers the plan when the date on screen names both', () => {
    expect(eventTargetOf('renewal:s1:2027-01-15', known, { subscriptionId: 's1', thingId: 't1' })).toEqual({ kind: 'plan', id: 's1' })
  })
})
