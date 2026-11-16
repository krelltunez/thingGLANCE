// thingglance:// links (docs/desktop.md, "Links"). The app has one link
// grammar and one place that reads it (src/core/links.ts, parseLink), so the
// main process does not parse a link: it checks that the thing it was handed
// is a thingglance:// URL of a sane length, stashes it, and the page opens it
// through openLink() like a link from anywhere else. A link only navigates;
// nothing it carries can change data.

export const DEEP_LINK_SCHEME = 'thingglance';
// parseLink refuses anything longer.
export const MAX_LINK_LENGTH = 2000;

/** The link, if it is one the page should be shown; null for anything else. */
export function acceptDeepLink(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const link = raw.trim();
  if (!link || link.length > MAX_LINK_LENGTH) return null;
  try {
    return new URL(link).protocol === `${DEEP_LINK_SCHEME}:` ? link : null;
  } catch {
    return null;
  }
}

/** The first thingglance:// URL on a command line (Windows and Linux hand URLs over as arguments). */
export function deepLinkFromArgv(argv: readonly string[]): string | null {
  const arg = argv.find((a) => typeof a === 'string' && a.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}://`));
  return arg ?? null;
}
