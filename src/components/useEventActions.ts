// What can be done with a horizon event from any list it appears in.

import type { HorizonEvent } from '@/core/types'
import { tr } from '@/core/text'
import { decide, patchSubscription, undecide, updateThing } from '@/db/queries'
import { IntentsUnavailableError, sendEventToDayglance } from '@/intents/emit'
import { useData } from '@/state/data'
import { toast } from '@/state/toast'
import { useUI } from '@/state/ui'

export function useEventActions() {
  const { thingById, meId } = useData()
  const ui = useUI()
  return {
    openEvent: (e: HorizonEvent) => {
      if (e.thingId) ui.openThing(e.thingId)
      else if (e.subscriptionId) ui.open({ type: 'subscription', id: e.subscriptionId })
    },
    dismiss: async (e: HorizonEvent) => {
      await decide(e.key, 'dismissed')
      toast({ title: tr('toast.cleared'), body: e.title, tone: 'ok', action: { label: tr('toast.undo'), run: () => void undecide(e.key) } })
    },
    restore: (e: HorizonEvent) => undecide(e.key),
    // "I'll deal with this": this device's member becomes the one responsible
    // for the plan (for a plan's date) or the thing (for anything else).
    take: async (e: HorizonEvent) => {
      if (!meId) return
      if (e.subscriptionId) await patchSubscription(e.subscriptionId, { responsibleMemberId: meId })
      else if (e.thingId) await updateThing(e.thingId, { responsibleMemberId: meId })
      toast({ title: tr('toast.yours'), body: e.detail, tone: 'ok' })
    },
    send: async (e: HorizonEvent) => {
      try {
        await sendEventToDayglance(e, e.thingId ? thingById.get(e.thingId) : null)
        toast({ title: tr('toast.sent'), body: e.title, tone: 'ok' })
      } catch (err) {
        if (err instanceof IntentsUnavailableError) {
          toast({
            title: err.reason === 'disabled' ? tr('toast.notConnected') : tr('toast.passphraseFirst'),
            body: tr('toast.tasksTravel'),
            action: { label: tr('toast.setUp'), run: () => ui.open({ type: 'settings', section: err.reason === 'disabled' ? 'integrations' : 'vault' }) },
          })
        } else {
          toast({ title: tr('toast.unreachable'), body: tr('toast.notSent'), tone: 'bad' })
        }
      }
    },
  }
}
