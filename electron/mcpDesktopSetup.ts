// From lastGLANCE electron/mcpDesktopSetup.ts (krelltunez/lastGLANCE@6fa5d77),
// itself after dayGLANCE's: keep a fix in step with them.
//
// The impure half of the "Set up Claude Desktop" button (docs/mcp.md,
// "Connecting an assistant"): read Claude Desktop's config, back it up, merge
// the thingglance entry (pure logic in mcpDesktopConfig.ts), write it back.
// Direct-download builds only.
//
// Unlike the sibling's, this module does not touch Electron: main.ts owns the
// IPC handler and hands in what the process knows, so the whole of it runs in
// a unit test against a folder of its own.
//
// LEFT OUT OF THE MAC APP STORE BUILD: this module and mcpDesktopConfig.ts are
// excluded from the MAS package by electron-builder.config.cjs, and main.ts
// loads this one dynamically, so its absence there is a refusal and nothing
// else. Never import either statically from anything that ships on MAS.
// scripts/verify-mas-compileout.mjs checks the built app.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { claudeConfigPath, claudeConfigIsPackaged, bridgeEntry, bridgeScriptPath, mergeClaudeConfig, manualEntrySnippet } from './mcpDesktopConfig.js';

/** What the button did. The page's copy is DesktopClaudeSetupResult (src/native/desktop.ts). */
export type ClaudeSetupResult =
  | { ok: true; action: 'created' | 'merged'; path: string; backupPath: string | null }
  | {
    ok: false;
    reason: 'unsupported_platform' | 'bridge_missing' | 'unreadable' | 'unparseable' | 'write_failed';
    path?: string;
    bridgePath?: string;
    manualEntry?: string;
    error?: string;
  };

export interface ClaudeSetupOptions {
  platform: string;
  env: Record<string, string | undefined>;
  home: string;
  /** process.execPath: the app's own binary, which the entry runs as Node. */
  execPath: string;
  /** process.resourcesPath: where the bundled bridge is. */
  resourcesPath: string;
  /**
   * The live MCP port and token, used only when Claude Desktop is packaged and
   * discovery cannot cross the container boundary (see bridgeEntry). Null
   * falls back to discovery.
   */
  connection: () => { port: number; token: string } | null;
  /**
   * A config file that stands in for Claude Desktop's own. A run on a profile
   * of its own (the tests) writes there, never where a person's Claude reads.
   * Only on a platform that has a Claude Desktop to set up.
   */
  configPath?: string | null;
  now?: () => Date;
}

/** Never throws: an unreadable or absent directory is simply no candidates. */
const dirProbe = {
  readDir(p: string): string[] {
    try {
      return readdirSync(p);
    } catch {
      return [];
    }
  },
};

/** Add thingGLANCE to Claude Desktop's config. Never throws. */
export function setUpClaudeDesktop(options: ClaudeSetupOptions): ClaudeSetupResult {
  const real = claudeConfigPath(options.platform, options.env, options.home, dirProbe);
  const path = real && options.configPath ? options.configPath : real;
  // Only override discovery where it provably cannot work. An unpackaged
  // install keeps the 0600 discovery file as the only place the token lives.
  const connection = path && claudeConfigIsPackaged(path) ? options.connection() : null;
  const entry = bridgeEntry(options.execPath, options.resourcesPath, connection);
  if (!path) {
    return { ok: false, reason: 'unsupported_platform', manualEntry: manualEntrySnippet(entry) };
  }

  // The bridge is put here by a per-platform extraResources entry, and a
  // platform that forgets to declare one still reaches this point with a
  // perfectly well-formed entry pointing at nothing. Writing it would leave
  // the user a config that looks right, a success message, and a client that
  // silently fails to connect, which is exactly what dayGLANCE's Windows build
  // did before this check existed. Report it instead.
  const bridgePath = bridgeScriptPath(options.resourcesPath);
  if (!existsSync(bridgePath)) {
    return { ok: false, reason: 'bridge_missing', path, bridgePath };
  }

  let existingText: string | null = null;
  try {
    existingText = readFileSync(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { ok: false, reason: 'unreadable', path, error: String((err as Error).message), manualEntry: manualEntrySnippet(entry) };
    }
  }

  const merged = mergeClaudeConfig(existingText, entry);
  if (merged.action === 'unparseable') {
    // NEVER overwrite a file we cannot parse: the user may have (broken)
    // hand-edits worth keeping, and Claude Desktop itself rewrites this
    // file when it dislikes an entry. Report and hand over the snippet.
    return { ok: false, reason: 'unparseable', path, manualEntry: manualEntrySnippet(entry) };
  }

  try {
    mkdirSync(dirname(path), { recursive: true });
    let backupPath: string | null = null;
    if (existingText !== null) {
      backupPath = `${path}.bak-thingglance-${(options.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-')}`;
      copyFileSync(path, backupPath);
    }
    writeFileSync(path, merged.text);
    return { ok: true, action: merged.action, path, backupPath };
  } catch (err) {
    return { ok: false, reason: 'write_failed', path, error: String((err as Error).message), manualEntry: manualEntrySnippet(entry) };
  }
}
