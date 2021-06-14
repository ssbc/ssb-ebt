const tape = require('tape')
const gen = require('ssb-generate')
const crypto = require('crypto')
const ssbKeys = require('ssb-keys')
const pify = require('promisify-4loc')
const sleep = require('util').promisify(setTimeout)
const SecretStack = require('secret-stack')
const u = require('./misc/util')

const createSbot = SecretStack({
  caps: { shs: crypto.randomBytes(32).toString('base64') }
})
  .use(require('ssb-db'))
  .use(require('ssb-replicate'))
  .use(require('../'))
  .use(require('ssb-friends'))

// SOMETIMES this test fails. I think it's just because
// some of the peers might be too far from the followed peer.
// TODO: create a thing that checks they where all actually reachable!

const CONNECTION_TIMEOUT = 500
const REPLICATION_TIMEOUT = 2 * CONNECTION_TIMEOUT

const alice = createSbot({
  temp: 'alice',
  port: 55451,
  host: 'localhost',
  timeout: CONNECTION_TIMEOUT,
  replicate: { hops: 3, legacy: false },
  keys: ssbKeys.generate()
})

const bob = createSbot({
  temp: 'bob',
  port: 55452,
  host: 'localhost',
  timeout: CONNECTION_TIMEOUT,
  replicate: { hops: 3, legacy: false },
  keys: ssbKeys.generate()
})

tape('generates feeds and tests EBT replication', async (t) => {
  t.ok(alice.getAddress(), 'alice has an address')

  await pify(alice.publish)({
    type: 'contact',
    contact: bob.id,
    following: true,
  })
  t.pass('alice publishes: follow bob')

  u.trackProgress(alice, 'alice')
  u.trackProgress(bob, 'bob')

  const peers = await pify(gen.initialize)(alice, 20, 3)

  t.pass('initialize ssb-generate')

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
    200,
  )
  t.pass('generate 200 random messages, approx 30% are follows')

  for (let i = 0; i < 50; i++) {
    const other = u.randary(peers).id
    u.log('bob.publish', { follow: other })
    await pify(bob.publish)({
      type: 'contact',
      contact: other,
      following: true
    })
  }
  t.pass('generate 50 follow messages from bob')

  await pify(bob.connect)(alice.getAddress())

  t.pass('bob is connected to alice')

  await sleep(REPLICATION_TIMEOUT)

  u.log('GET VECTOR CLOCK', alice.status())

  const clockAlice = await pify(alice.getVectorClock)()
  const clockBob = await pify(bob.getVectorClock)()

  let diff = 0

  for (const k in clockBob) {
    if (clockAlice[k] !== clockBob[k]) {
      diff += (clockAlice[k] || 0) - clockBob[k]
    }
  }

  u.log('A', u.countClock(clockAlice), 'B', u.countClock(clockBob), 'diff', diff)

  if (diff === 0) {
    t.pass('the clocks between alice and bob match')
    const prog = alice.progress()
    t.ok(prog.indexes, 'alice indexes are okay')
    t.ok(prog.ebt, 'alice ebt is okay')
    t.ok(prog.ebt.target, 'alice ebt.target is okay')
    t.strictEqual(prog.ebt.current, prog.ebt.target, 'alice ebt finished')

    await Promise.all([
      pify(alice.close)(true),
      pify(bob.close)(true),
    ])
    t.end()
  } else {
    t.fail('inconsistent: ' + JSON.stringify(alice.status().ebt))
  }
})
