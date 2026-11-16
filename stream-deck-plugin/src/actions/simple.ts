import { action, type KeyDownEvent } from '@elgato/streamdeck';
import { addKey, chargesKey, waitingKey } from '../keys';
import { acknowledge, connection, draw } from '../shared';
import { StateAction } from './state-action';

/** The Waiting key: how many dates are waiting on a decision; opens them in the app. */
@action({ UUID: 'com.thingglance.streamdeck.waiting' })
export class WaitingAction extends StateAction {
  protected async renderAll(): Promise<void> {
    for (const a of this.actions) await draw(a, waitingKey(this.state));
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    await acknowledge(ev.action, await connection.openApp('thingglance://queue'));
  }
}

/** The Charges key: what the plans will charge over the next 30 days; opens the plans. */
@action({ UUID: 'com.thingglance.streamdeck.charges' })
export class ChargesAction extends StateAction {
  protected async renderAll(): Promise<void> {
    for (const a of this.actions) await draw(a, chargesKey(this.state));
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    await acknowledge(ev.action, await connection.openApp('thingglance://view/plans'));
  }
}

/** Opens the app at Add a thing. */
@action({ UUID: 'com.thingglance.streamdeck.add-thing' })
export class AddThingAction extends StateAction {
  protected async renderAll(): Promise<void> {
    for (const a of this.actions) await draw(a, addKey(this.state));
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    await acknowledge(ev.action, await connection.openApp('thingglance://action/add'));
  }
}
