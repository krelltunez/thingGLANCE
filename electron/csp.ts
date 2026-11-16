// The Content-Security-Policy for every document the renderer loads
// (docs/desktop.md).
//
// connect-src 'self' is the point: the renderer makes no network request of
// its own. Sync, the vault, intents and the product lookups go through the
// main process, so a fetch site that was missed fails loudly here instead of
// meeting a server's CORS rules. 'self' is app://thingglance.
//
//  - script-src 'self': only the bundle's own scripts; no inline script, no eval.
//  - style-src 'unsafe-inline': React sets inline style attributes.
//  - img-src data: blob:: icon data URLs and blob previews. The one outside
//    host is Wikimedia's image server: a thing's photo is the thumbnail the
//    lookup found (src/lookup/wikipedia.ts), shown with an <img>, which is not
//    a request the app's own code makes or reads.
//  - object-src, base-uri, frame-src 'none': no plugins, no base-tag injection,
//    no frames.

export const IMAGE_HOSTS = ['https://upload.wikimedia.org'];

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  `img-src 'self' data: blob: ${IMAGE_HOSTS.join(' ')}`,
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join('; ');
