import { describe, expect, it } from 'vitest'
import { cleanWikitext, parseInfobox } from './wikipedia'
import { matchRelease } from './endoflife'

describe('infobox parsing', () => {
  const wikitext = `{{Short description|2023 smartphone}}
{{Infobox mobile phone
| name = iPhone 15 Pro<br />iPhone 15 Pro Max
| developer = [[Apple Inc.|Apple]]
| colors = {{plainlist|
* {{Color sample|#F2F1EB}} White titanium
* {{Color sample|#3D4555}} Blue titanium
}}
| released = {{Start date and age |2023|09|22}}
| soc = [[Apple A17|Apple A17 Pro]]<ref name="x">{{cite web|url=http://e.com|title=T}}</ref>
| memory = 8 GB [[LPDDR5]]
| display = {{convert|6.1|in|mm|abbr=on}} [[OLED]]<!-- comment -->
| weight = {{nowrap|187 g}}
}}
Body text {{not an infobox}}.`

  it('reads top-level fields and ignores nested pipes', () => {
    const f = parseInfobox(wikitext)
    expect(f.developer).toBe('Apple')
    expect(f.released).toBe('2023-09-22')
    expect(f.soc).toBe('Apple A17 Pro')
    expect(f.memory).toBe('8 GB LPDDR5')
    expect(f.display).toBe('6.1 in OLED')
    expect(f.weight).toBe('187 g')
    expect(f.colors).toBe('White titanium, Blue titanium')
  })
  it('returns nothing when there is no infobox', () => {
    expect(parseInfobox('Just an article.')).toEqual({})
  })
  it('cleans markup to plain text', () => {
    expect(cleanWikitext("'''Original:''' [[iOS 17]]<br />{{Current iOS}}")).toBe('Original: iOS 17')
  })
})

describe('release matching', () => {
  const rel = (label: string) => ({ name: label.toLowerCase().replace(/ /g, '-'), label, releaseDate: null, isEol: false, eolFrom: null, isMaintained: true })
  const iphones = ['15', '15 Plus', '15 Pro', '15 Pro Max', '16', 'SE (3rd generation)'].map(rel)
  const strip = /apple|iphone/gi

  it('prefers the most specific release whose words are all in the name', () => {
    expect(matchRelease('iPhone 15 Pro', iphones, strip)?.label).toBe('15 Pro')
    expect(matchRelease('Apple iPhone 15 Pro Max 256 GB', iphones, strip)?.label).toBe('15 Pro Max')
    expect(matchRelease('iPhone 15', iphones, strip)?.label).toBe('15')
  })
  it('does not guess when nothing matches', () => {
    expect(matchRelease('iPhone 99', iphones, strip)).toBeNull()
  })
})
