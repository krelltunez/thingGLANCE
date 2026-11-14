// What the hardware back button closes. The app has no router, so "back" means
// "close the thing on top": a sheet, the detail drawer, then the view itself.
// The app shell registers one handler that knows what is open; a native shell
// asks it, and leaves the app only when it answers false.

type BackHandler = () => boolean

let handler: BackHandler | null = null

export function setBackHandler(fn: BackHandler | null): void {
  handler = fn
}

// True when something was closed.
export function goBack(): boolean {
  try {
    return handler ? handler() : false
  } catch {
    return false
  }
}
