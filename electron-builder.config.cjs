// electron-builder config for the thingGLANCE desktop app (docs/desktop.md).
// After lastGLANCE's electron-builder.config.cjs, itself after dayGLANCE's
// (krelltunez/dayGLANCE@8d72008), whose comments explain the lessons kept here.
//
// Signing is driven by the environment:
//
//   Developer ID (release-desktop.yml, or locally with these set):
//     CSC_LINK, CSC_KEY_PASSWORD      the Developer ID Application .p12
//     APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID  for notarization
//   With no CSC_LINK, macOS builds are ad-hoc signed by the afterPack hook (an
//   "unidentified developer" prompt instead of a hard "damaged" block).
//
//   Mac App Store (npm run build:electron:mas, built locally and uploaded with
//   Transporter; docs/desktop.md, "Releasing"): the "Apple Distribution" (or
//   "3rd Party Mac Developer Application") and "Mac Installer Distribution"
//   certificates in the login keychain, and the provisioning profile at
//   electron/thingglance.mas.provisionprofile (git-ignored) or wherever
//   MAC_PROVISIONING_PROFILE points.

const { readdirSync } = require('node:fs');
const path = require('node:path');

// The shipped languages, read from where the app keeps its catalogs, so a new
// one reaches the macOS bundle metadata with nothing else to remember.
const SHIPPED_LANGUAGES = readdirSync(path.join(__dirname, 'src', 'locales'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

// Apple's spelling where it differs from ours (CFBundleLocalizations only).
const APPLE_LANGUAGE_IDS = { 'zh-CN': 'zh-Hans' };

const hasCert = Boolean(process.env.CSC_LINK);
// The MAS script is the only thing that sets THINGGLANCE_MAS_BUILD. Such a
// build signs from the keychain (no CSC_LINK) and must never inherit the
// ad-hoc `identity: null` below, which would skip signing.
const isMasBuild = process.env.THINGGLANCE_MAS_BUILD === '1';

// CFBundleVersion for App Store uploads, which must strictly increase:
// YYYYMMDD.HHMM from the build time (BUILD_NUMBER overrides). The marketing
// version stays package.json's. Set on MAS builds only.
function masBuildVersion() {
  if (process.env.BUILD_NUMBER) return process.env.BUILD_NUMBER;
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.${p(d.getHours())}${p(d.getMinutes())}`;
}

// Packages main imports at run time, with everything they import in turn: the
// MCP host kit and the SDK it serves (docs/mcp.md). builderConfig.test.ts
// computes the closure from main's imports and holds this list to it.
const MAIN_RUNTIME_PACKAGES = [
  '@glance-apps/mcp-host',
  '@modelcontextprotocol/server',
  '@modelcontextprotocol/node',
  '@modelcontextprotocol/core',
  '@hono/node-server',
  'hono',
  'zod',
];

/** @type {import('electron-builder').Configuration} */
module.exports = {
  // One id everywhere: Android, iOS and every desktop build, the Mac App Store
  // one included (docs/ROADMAP.md, "Identifiers"). Matching iOS and Mac ids is
  // what lets one purchase cover both.
  appId: 'com.thingglance.app',
  ...(isMasBuild ? { buildVersion: masBuildVersion() } : {}),
  productName: 'thingGLANCE',
  copyright: 'Copyright © 2026 GLANCE Apps',
  afterPack: './scripts/codesign-ad-hoc.cjs',
  // Notarizes a Developer ID build; a no-op without CSC_LINK and for MAS.
  afterSign: './scripts/notarize.cjs',
  // No native runtime dependency ships (see files), so there is nothing for
  // @electron/rebuild to compile.
  npmRebuild: false,
  directories: {
    buildResources: 'electron/resources',
    output: 'dist-app',
  },
  // The renderer is one Vite bundle, so its dependencies are already inside
  // dist/ and node_modules is left out. Main is compiled by tsc, not bundled,
  // so what main imports would ship beside it (MAIN_RUNTIME_PACKAGES).
  // Sourcemaps stay out of the package.
  // thingglance:// (docs/desktop.md, "Links"): CFBundleURLTypes on macOS, the
  // registry on Windows (NSIS), and the .desktop MimeType on Linux, which the
  // deb registers on install and an AppImage only once integrated.
  protocols: [{ name: 'thingGLANCE', schemes: ['thingglance'] }],
  files: [
    'dist/**/*',
    'dist-electron/**/*',
    '!**/*.map',
    '!node_modules/**/*',
    ...MAIN_RUNTIME_PACKAGES.map((name) => `node_modules/${name}/**/*`),
  ],
  // The tray icons, outside the asar so nativeImage reads them from
  // process.resourcesPath/tray.
  extraResources: [{ from: 'electron/resources/tray', to: 'tray' }],
  mac: {
    // null: ad-hoc (no certificate); undefined: electron-builder picks the
    // Developer ID identity when CSC_LINK is set.
    identity: hasCert || isMasBuild ? undefined : null,
    hardenedRuntime: hasCert,
    // Notarization is the afterSign hook's job (scripts/notarize.cjs).
    notarize: false,
    entitlements: 'electron/entitlements.mac.plist',
    entitlementsInherit: 'electron/entitlements.mac.plist',
    category: 'public.app-category.productivity',
    icon: 'electron/resources/icon-mac.png',
    // Only the shipped languages' .lproj folders survive; Apple reads the
    // folders as the app's languages (dayGLANCE's listing once claimed 50+).
    electronLanguages: SHIPPED_LANGUAGES,
    extendInfo: {
      CFBundleLocalizations: SHIPPED_LANGUAGES.map((l) => APPLE_LANGUAGE_IDS[l] || l),
    },
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
  },
  // The Mac App Store build: sandboxed, so no Hardened Runtime; a universal
  // .pkg (the script passes --mac mas --universal).
  mas: {
    type: 'distribution',
    hardenedRuntime: false,
    entitlements: 'electron/entitlements.mas.plist',
    entitlementsInherit: 'electron/entitlements.mas.inherit.plist',
    provisioningProfile: process.env.MAC_PROVISIONING_PROFILE || 'electron/thingglance.mas.provisionprofile',
    category: 'public.app-category.productivity',
  },
  win: {
    icon: 'electron/resources/icon.png',
    target: [{ target: 'nsis' }],
  },
  // The AppImage's own options: forces the arch into every AppImage name (x64
  // otherwise loses its suffix and gets downloaded onto ARM), without renaming
  // the deb, which keeps Debian's name_version_arch.deb.
  appImage: {
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },
  linux: {
    // category is REQUIRED (no mapping exists for the mac category; the app
    // lands in "Other"), icon avoids the generic Electron icon, and the
    // description becomes the launcher tooltip.
    category: 'Office',
    description: "Know what's next for your things: warranties, subscriptions, support windows and the right moment to upgrade.",
    icon: 'electron/resources/icon.png',
    desktop: {
      entry: {
        Keywords: 'warranty;subscriptions;renewals;devices;household;tracker;',
      },
    },
    // Required by the deb target, which fails the build without it. Public
    // project contact: it ships inside every package.
    maintainer: 'GLANCE Apps <hello@glance-apps.com>',
    // The arch list is explicit: the default is only the build host's arch.
    // Cross-packaging arm64 on x64 is sound while no runtime dependency is
    // native (none ship; see files above).
    target: [
      { target: 'AppImage', arch: ['x64', 'arm64'] },
      { target: 'deb', arch: ['x64', 'arm64'] },
    ],
  },
};
