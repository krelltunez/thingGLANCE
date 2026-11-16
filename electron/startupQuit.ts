// From dayGLANCE electron/startupQuit.ts (krelltunez/dayGLANCE@8d72008), less
// its globalShortcut half, which main.ts handles where it registers them.
//
// Decision logic for the `window-all-closed` -> `app.quit()` handler, a pure
// function so the startup-safety invariant is tested without booting Electron.
//
// THE BUG THIS ENCODES (dayGLANCE, Windows and Linux): a hidden utility window
// created and destroyed BEFORE the main window fires `window-all-closed` while
// no real window exists yet. Quitting on it exits mid-startup and the app
// "installs but never launches". The tray popup (docs/desktop.md) is such a
// window.

/**
 * Whether the `window-all-closed` event should quit the app.
 *
 *  - macOS (`darwin`): never. The app stays in the dock and menu bar and is
 *    reopened from there, as Mac apps are.
 *  - Windows/Linux: only once the real main window has been created. Before
 *    that, the event can only come from a transient window.
 *
 * @param platform          `process.platform`
 * @param mainWindowCreated whether `createWindow()` has run at least once
 */
export function shouldQuitOnAllWindowsClosed(
  platform: NodeJS.Platform,
  mainWindowCreated: boolean,
): boolean {
  if (platform === 'darwin') return false;
  return mainWindowCreated;
}
