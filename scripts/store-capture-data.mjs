// The data every store capture is made on (scripts/store-captures.mjs, and
// scripts/store-capture-popup.mjs for the Mac's menu bar popup): the app's
// sample set made into real rows, with a household around it. Run in a page
// served by the dev server, where the app's own modules can be imported.

// The household and its things, written straight into the page's own database.
export async function seed(page) {
  await page.evaluate(async () => {
    const { buildSamples } = await import('/src/db/demo.ts')
    const { db } = await import('/src/db/client.ts')
    const q = await import('/src/db/queries.ts')
    const addMonths = (ymd, months) => {
      const [y, m, d] = ymd.split('-').map(Number)
      const at = new Date(Date.UTC(y, m - 1 + months, d))
      return at.toISOString().slice(0, 10)
    }

    const [alex, sam, riley] = [await q.addMember('Alex'), await q.addMember('Sam'), await q.addMember('Riley')]
    await q.attachThisDevice(alex.id, 'This device')

    const s = buildSamples()
    const real = ({ sample: _sample, ...row }) => row
    const owners = { 'MacBook Pro 14″': alex.id, 'iPhone 15 Pro': alex.id, 'iPad Air': riley.id, 'WH-1000XM5': sam.id, 'Kindle Paperwhite': sam.id }
    const things = s.things.map(real).map((t) => {
      // An out-of-support device that is not another platform's phone.
      const swapped = t.name === 'Pixel 6'
        ? { ...t, name: 'Kindle Paperwhite', category: 'tablet', brand: 'Amazon', model: '10th generation, 8 GB', retailer: 'Amazon', price: 129, notes: undefined }
        : t
      return { ...swapped, ownerMemberId: owners[swapped.name] ?? null, responsibleMemberId: owners[swapped.name] === alex.id ? alex.id : null }
    })
    const tv = things.find((t) => t.name.startsWith('LG C3'))
    const plans = s.subscriptions.map(real).map((p) => {
      if (p.name === 'YouTube Premium') return { ...p, name: 'Spotify Premium Family', provider: 'Spotify', amount: 19.99, coversHousehold: true, coversSet: true }
      if (p.name === 'iCloud+ 2 TB') return { ...p, payerMemberId: alex.id }
      return p
    })
    // A fixed term: paid monthly from the day the TV was bought, with six months left.
    const stamp = new Date().toISOString()
    plans.push({
      id: 'capture-plan-financing', kind: 'subscription', name: 'TV financing', provider: 'Best Buy', amount: 49.97, cycle: 'monthly',
      anchorDate: tv.purchaseDate, startDate: tv.purchaseDate, endDate: addMonths(tv.purchaseDate, 36),
      autoRenew: true, status: 'active', review: false, coversThingIds: [tv.id], coversMemberIds: [],
      payerMemberId: null, responsibleMemberId: null, visibility: 'shared', createdAt: stamp, updatedAt: stamp,
    })
    await db.things.bulkPut(things)
    await db.coverages.bulkPut(s.coverages.map(real))
    await db.subscriptions.bulkPut(plans)
    localStorage.setItem('tg_welcomed', '1')
  })
  await page.reload()
  await page.getByText('Needs a decision').first().waitFor()
}
