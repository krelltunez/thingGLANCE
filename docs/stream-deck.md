# Stream Deck

thingGLANCE on a Stream Deck: what is waiting on a decision, on your keys, settled with a press. It has two halves: a listener in the desktop app, and a plugin Stream Deck runs. The model is lastGLANCE's (`../lastGLANCE/docs/mcp-and-stream-deck.md`, section 6), which follows dayGLANCE's.

| | |
| --- | --- |
| Where it listens | `127.0.0.1:7911` only, in the desktop app's main process |
| Default | Off. Settings, Integrations, "On this computer", Stream Deck |
| What a key can change | One thing: mark a date in the queue done |
| Plugin id | `com.thingglance.streamdeck` |

## The keys

| Action | Shows | Press | Dial (Stream Deck +) |
| --- | --- | --- | --- |
| Queue | The dates waiting on a decision, one at a time, most pressing first: the countdown ("T-9d"), what it is about, and its place ("2/5") | Tap shows the next; hold (half a second) marks the shown one done | Turn to move; push or tap the strip to mark it done |
| Waiting | How many dates are waiting, big; red when one is urgent | Opens the queue in the app | |
| Coming up | The dates ahead that are not in the queue, soonest first | Opens the one shown | Turn to move; push or tap to open |
| Charges | What your plans will charge over the next 30 days | Opens your plans | |
| Thing | One thing: its category's icon in its verdict's colour, how long it has left, and a bar of its window still ahead. Chosen in the key's settings; with none chosen, the thing closest to the end of its window | Opens it | |
| Add a thing | A plus | Opens Add a thing | |

- **Not connected is not "nothing waiting".** With the app closed every key says "Not running", and connected before the app's first snapshot it says "Open the app".
- **A press shows the app's answer**: a tick for done (and for a second press the app refused, since the date is settled), an alert otherwise.
- **The countdown is the app's notation**, and names and titles come from the app in its language. The few words the plugin adds ("waiting", "All clear") are English only: Stream Deck gives a plugin no language of the app's.

## The desktop side

- **The listener** (`electron/streamDeckServer.ts`) is a WebSocket server started and stopped by the Settings switch. A port that is taken is a message in Settings.
- **Trust** is dayGLANCE's model, kept on purpose. A client with no `Origin` header is a native process (the plugin's Node backend) and is trusted. A client with an `Origin` (a browser, a web page) must present a session token within five seconds or is dropped, and a `Host` header that is not this machine's loopback is refused before that. That is what keeps a web page from driving the socket. Any local process can connect, which is the reach a local process already has to the app's files.
- **Every frame is parsed** against the protocol and anything else is dropped. Frames over 16 KB are refused.
- **What the keys show comes from the payload the tray already holds** (`electron/deckModel.ts`): no new push from the page. The days are counted again from each date by the clock, on a one-minute tick, so a countdown turns at midnight with the window closed.
- **A press goes through the command queue**, as the tray's does ([desktop.md](desktop.md#writes-from-outside-the-window)), with the source `streamdeck`. It must not be lost if the window is busy, and it needs no reply beyond "queued".
- **No double presses.** A press only ever marks a date done, and the app refuses a second one for the same date within a minute (`too_soon`). The date leaves the keys at once, as it leaves the tray.
- **A key opens only `thingglance://` links**, which the page reads like a link from anywhere else.

## The protocol

`electron/deckProtocol.ts`, shared by the app and the plugin (the plugin's bundle imports it), version 1.

| Direction | Message | What it is |
| --- | --- | --- |
| App to plugin | `tg:state` | Everything the keys draw: whether the app is ready, how many are waiting, the queue, what is coming up, the things, the charges, the currency and locale |
| App to plugin | `tg:token` | A session token, for a property inspector that opens its own socket (this plugin's does not) |
| App to plugin | `tg:result` | The answer to one command, by its `clientId` |
| Plugin to app | `tg:event:decide` | "Done with this" on a date, by its key |
| Plugin to app | `tg:open` | Show the app, at a link or as it is |
| Page to app | `tg:auth` | A token, as the first frame |

## The plugin

`stream-deck-plugin/`, with its own `package.json` and lockfile: `@elgato/streamdeck` v2 (SDK 2, Node 20).

- **What each key shows is a pure function** of the app's state (`src/keys.ts`), so it is tested without Stream Deck. Keys are drawn as SVG (`src/render.ts`), 144 by 144 on a key and 200 by 100 on a Stream Deck + touch strip.
- **The connection** (`src/connection.ts`) is one socket with no `Origin`, reconnecting with backoff from 1 to 30 seconds. Every command carries a `clientId` and waits up to five seconds for its answer.
- **The Thing key's picker** asks the plugin for the list over Stream Deck's own property inspector channel, not over a second socket.
- **Icons** are generated from the app's own `lucide-react` (`scripts/gen-assets.mjs`): one per kind of date and per category of thing, the same the app draws. `src/keyIcons.ts` repeats the app's two maps and a test holds them equal.

### Building it

```bash
npm ci
```

```bash
npm ci --prefix stream-deck-plugin
```

```bash
npm run build --prefix stream-deck-plugin
```

Then `npm run validate` and `npm run pack` in `stream-deck-plugin/` check the manifest with Elgato's tool and write `dist/com.thingglance.streamdeck.streamDeckPlugin`. Its tests run with the app's (`npm test`), including one that drives the plugin's real connection against the app's real listener over a socket. CI builds, validates and packs it, and the release workflow adds the packed plugin to the tag's release.

### Releasing it

The plugin's version is its own, not the app's. When the plugin changed, bump `Version` in the manifest (four parts, `1.0.1.0`) and `version` in `stream-deck-plugin/package.json` before tagging. Publishing on the Elgato Marketplace is a manual step **(yours)**: install the `.streamDeckPlugin` from the release on a machine with Stream Deck 6.5 or later, check a Queue key against the running app, then submit it in the maker portal with the release notes (no em dashes).

## Not checked on hardware

Everything above is tested without a Stream Deck: the keys' views, the drawing, the connection, the two halves together over a socket, and the listener in the packaged app. Elgato's tool validates the manifest and packs the plugin. What has not happened is the plugin running inside the Stream Deck software on a real device: how the keys look lit, the hold-to-mark-done timing, the dial and the touch strip, and the Thing key's picker.
