import { describe, expect, it } from 'vitest';
import { LINK_SCHEME, parseLink } from '../src/core/links';
import { DEEP_LINK_SCHEME, MAX_LINK_LENGTH, acceptDeepLink, deepLinkFromArgv } from './deepLink';

describe('thingglance:// links in the main process', () => {
  it('uses the app\'s own scheme', () => {
    expect(DEEP_LINK_SCHEME).toBe(LINK_SCHEME);
  });

  it.each(['thingglance://thing/abc', 'thingglance://queue', 'thingglance://action/add?name=Pixel%209', 'THINGGLANCE://view/horizon'])(
    'passes %s on to the page', (link) => { expect(acceptDeepLink(link)).toBe(link); });

  it.each(['https://example.com/', 'lastglance://chore/1', 'javascript:alert(1)', 'thingglance', '', '   ', 42, null, undefined])(
    'refuses %s', (link) => { expect(acceptDeepLink(link)).toBeNull(); });

  it('refuses a link longer than the page would read', () => {
    expect(acceptDeepLink(`thingglance://search?q=${'a'.repeat(MAX_LINK_LENGTH)}`)).toBeNull();
  });

  it('is not the judge of where a link goes: the page is', () => {
    // Accepted here, and the app's parser then finds nothing to open.
    expect(acceptDeepLink('thingglance://nowhere/at/all')).toBe('thingglance://nowhere/at/all');
    expect(parseLink('thingglance://nowhere/at/all')).toBeNull();
  });

  it('finds a link among the arguments Windows and Linux start the app with', () => {
    expect(deepLinkFromArgv(['/opt/thingGLANCE/thingglance', '--hidden', 'thingglance://thing/abc'])).toBe('thingglance://thing/abc');
    expect(deepLinkFromArgv(['/opt/thingGLANCE/thingglance', '--hidden'])).toBeNull();
  });
});
