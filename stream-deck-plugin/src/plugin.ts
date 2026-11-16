// thingGLANCE for Stream Deck (docs/stream-deck.md): registers the six actions
// and connects to the desktop app on this computer.
import streamDeck from '@elgato/streamdeck';
import { connection } from './shared';
import { ComingUpAction, QueueAction } from './actions/queue';
import { AddThingAction, ChargesAction, WaitingAction } from './actions/simple';
import { ThingAction } from './actions/thing';

// The SDK runs action handlers as unawaited promises: a rejection would end the
// process, and every key with it.
process.on('unhandledRejection', (reason) => streamDeck.logger.error(`unhandled: ${String(reason)}`));

streamDeck.actions.registerAction(new QueueAction());
streamDeck.actions.registerAction(new WaitingAction());
streamDeck.actions.registerAction(new ComingUpAction());
streamDeck.actions.registerAction(new ChargesAction());
streamDeck.actions.registerAction(new ThingAction());
streamDeck.actions.registerAction(new AddThingAction());

connection.start();
streamDeck.connect().catch((err) => streamDeck.logger.error(`connect failed: ${err}`));
