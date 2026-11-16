import { action, type DidReceiveSettingsEvent, type KeyDownEvent, type SendToPluginEvent } from '@elgato/streamdeck';
import type { JsonValue } from '@elgato/utils';
import streamDeck from '@elgato/streamdeck';
import { thingKey } from '../keys';
import { acknowledge, connection, draw } from '../shared';
import { StateAction } from './state-action';

type Settings = { thingId?: string };

// The Thing key: one thing, its category's icon in its verdict's colour, how
// long it has left and the bar of its window still ahead. A press opens it in
// the app. The thing is chosen in the property inspector (ui/thing.html),
// which gets the list from here over Stream Deck's own channel; with none
// chosen the key shows whichever thing is closest to the end of its window.
@action({ UUID: 'com.thingglance.streamdeck.thing' })
export class ThingAction extends StateAction<Settings> {
  protected async renderAll(): Promise<void> {
    for (const a of this.actions) {
      const { thingId } = await a.getSettings();
      await draw(a, thingKey(this.state, thingId ?? null).view);
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
    await draw(ev.action, thingKey(this.state, ev.payload.settings.thingId ?? null).view);
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    const { thing } = thingKey(this.state, ev.payload.settings.thingId ?? null);
    await acknowledge(ev.action, await connection.openApp(thing ? thing.link : 'thingglance://view/things'));
  }

  // The inspector asks for the things to choose from.
  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, Settings>): Promise<void> {
    const payload = ev.payload as { event?: string } | null;
    if (payload?.event !== 'tg-list-things') return;
    const state = this.state;
    await streamDeck.ui.sendToPropertyInspector({
      event: 'tg-things',
      connected: state !== null,
      things: (state?.things ?? []).map((t) => ({ id: t.id, name: t.name })),
    });
  }
}
