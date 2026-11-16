import { action } from '@elgato/streamdeck';
import type { DeckEvent, DeckState } from '../../../electron/deckProtocol';
import { comingUpKey, queueKey } from '../keys';
import { acknowledge, connection } from '../shared';
import { ListAction, type ListView } from './list-action';

export { HOLD_MS } from './list-action';

type Target = Parameters<typeof acknowledge>[0];
const QUEUE_LINK = 'thingglance://queue';

// The Queue key: the dates waiting on a decision, one at a time, most pressing
// first. A tap shows the next, a hold marks the shown one done ("Done with
// this" in the app); on a dial, turn to move and push or tap the strip to mark
// it done. Pressed again within the minute the app answers "already done",
// never a second write. With nothing waiting, a hold opens the app.
@action({ UUID: 'com.thingglance.streamdeck.queue' })
export class QueueAction extends ListAction<DeckEvent | null> {
  protected readonly keyMode = 'cycle';
  protected show(state: DeckState | null, index: number): ListView<DeckEvent | null> {
    const v = queueKey(state, index);
    return { ...v, item: v.event };
  }
  protected async act(target: Target, event: DeckEvent | null): Promise<void> {
    if (!event) { await connection.openApp(QUEUE_LINK); return; }
    await acknowledge(target, await connection.decide(event.key));
  }
}

// The Coming up key: the dates ahead that are not in the queue, soonest first,
// the first on a key. Pressing a key, or pushing or tapping a dial, opens the
// date shown in the app; turning a dial moves through them.
@action({ UUID: 'com.thingglance.streamdeck.coming-up' })
export class ComingUpAction extends ListAction<DeckEvent | null> {
  protected readonly keyMode = 'press';
  protected show(state: DeckState | null, index: number): ListView<DeckEvent | null> {
    const v = comingUpKey(state, index);
    return { ...v, item: v.event };
  }
  protected async act(target: Target, event: DeckEvent | null): Promise<void> {
    await acknowledge(target, await connection.openApp(event ? event.link : 'thingglance://view/horizon'));
  }
}
