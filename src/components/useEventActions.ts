// What can be done with a horizon event from any list it appears in.

import type { HorizonEvent } from '@/core/types'
import { decide, undecide } from '@/db/queries'
import { IntentsUnavailableError, sendEventToDayglance } from '@/intents/emit'
import { useData } from '@/state/data'
import { toast } from '@/state/toast'
import { useUI } from '@/state/ui'

export function useEventActions() {
  const { thingById } = useData()
  const ui = useUI()
  return {
    openEvent: (e: HorizonEvent) => {
      if (e.thingId) ui.openThing(e.thingId)
      else if (e.subscriptionId) ui.open({ type: 'subscription', id: e.subscriptionId })
    },
    dismiss: async (e: HorizonEvent) => {
      await decide(e.key, 'dismissed')
      toast({ title: 'Cleared from your queue', body: e.title, tone: 'ok', action: { label: 'Undo', run: () => void undecide(e.key) } })
    },
    restore: (e: HorizonEvent) => undecide(e.key),
    send: async (e: HorizonEvent) => {
      try {
        await sendEventToDayglance(e, e.thingId ? thingById.get(e.thingId) : null)
        toast({ title: 'Sent to dayGLANCE', body: e.title, tone: 'ok' })
      } catch (err) {
        if (err instanceof IntentsUnavailableError) {
          toast({
            title: err.reason === 'disabled' ? 'dayGLANCE is not connected yet' : 'Enter your sync passphrase first',
            body: 'Tasks travel through GLANCEvault, end-to-end encrypted.',
            action: { label: 'Set up', run: () => ui.open({ type: 'settings', section: err.reason === 'disabled' ? 'integrations' : 'vault' }) },
          })
        } else {
          toast({ title: 'Could not reach GLANCEvault', body: 'The task was not sent. Try again in a moment.', tone: 'bad' })
        }
      }
    },
  }
}
