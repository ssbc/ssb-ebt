const tape = require('tape')
const gen = require('ssb-generate')
const crypto = require('crypto')
const ssbKeys = require('ssb-keys')
const pify = require('promisify-4loc')
const sleep = require('util').promisify(setTimeout)
const u = require('./misc/util')

const createSbot = require('secret-stack')({
  caps: { shs: crypto.randomBytes(32).toString('base64') }
})
  .use(require('ssb-db'))
  .use(require('ssb-replicate'))
  .use(require('../'))
  .use(require('ssb-friends'))

const CONNECTION_TIMEOUT = 500 // ms
const REPLICATION_TIMEOUT = 2 * CONNECTION_TIMEOUT

const alice = createSbot({
  temp: 'alice',
  timeout: CONNECTION_TIMEOUT,
  replicate: { hops: 3, legacy: false },
  keys: ssbKeys.generate()
})

const bob = createSbot({
  temp: 'bob',
  timeout: CONNECTION_TIMEOUT,
  replicate: { hops: 3, legacy: false },
  keys: ssbKeys.generate()
})

u.trackProgress(alice, 'alice')
u.trackProgress(bob, 'bob')

tape('peer can recover and resync its content from a friend', async (t) => {
  t.plan(6)
  t.ok(alice.getAddress(), 'alice has an address')

  await pify(alice.publish)({
    type: 'contact',
    contact: bob.id,
    following: true,
  })
  t.pass('alice publishes: follow bob')

  // alice has data from some random peers
  const peers = await pify(gen.initialize)(alice, 50, 4)

  // in this test, bob's feed is on alice,
  // because bob's database corrupted (but had key backup)
  peers.push(alice.createFeed(bob.keys))
  t.pass('alice has bob\'s content')

  await pify(gen.messages)(
    function (n) {
      if (Math.random() < 0.3) {
        return {
          type: 'contact',
          contact: u.randary(peers).id,
          following: true,
        }
      }
      return {
        type: 'test',
        ts: Date.now(),
        random: Math.random(),
        value: u.randbytes(u.randint(1024)).toString('base64'),
      }
    },
    peers,
    1000,
  )
  t.pass('done generating msgs')

  await pify(bob.connect)(alice.getAddress())

  await sleep(REPLICATION_TIMEOUT)

  const clockAlice = await pify(alice.getVectorClock)()
  const clockBob = await pify(bob.getVectorClock)()

  let diff = 0
  let commonCount = 0
  for (const k in clockBob) {
    if (clockAlice[k] !== clockBob[k]) {
      diff += (clockAlice[k] || 0) - clockBob[k]
    } else {
      commonCount++
    }
  }

  u.log('A', u.countClock(clockAlice), 'B', u.countClock(clockBob), 'diff', diff, 'common', commonCount)
  t.equals(diff, 0, 'no diff between alice and bob')
  t.equals(commonCount > 0, true, 'bob has some content')

  await Promise.all([
    pify(alice.close)(true),
    pify(bob.close)(true),
  ])
  t.end()
})
