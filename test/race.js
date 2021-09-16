const tape = require('tape')
const crypto = require('crypto')
const rimraf = require('rimraf')
const ssbKeys = require('ssb-keys')
const pify = require('promisify-4loc')
const sleep = require('util').promisify(setTimeout)
const u = require('./misc/util')

function delayedVectorClock(sbot, config) {
  const realGetVectorClock = sbot.getVectorClock
  sbot.getVectorClock = (cb) => {
    setTimeout(() => realGetVectorClock(cb), 1000)
  }
}

const createSbot = require('secret-stack')({
  caps: { shs: crypto.randomBytes(32).toString('base64') },
})
  .use(require('ssb-db'))
  .use(delayedVectorClock)
  .use(require('../'))

const CONNECTION_TIMEOUT = 500 // ms
const REPLICATION_TIMEOUT = 2 * CONNECTION_TIMEOUT

tape('we wait for vectorclock being available before doing ebt', async (t) => {
  rimraf.sync('/tmp/alice')
  rimraf.sync('/tmp/bob')

  const aliceKeys = ssbKeys.generate()
  let alice = createSbot({
    path: '/tmp/alice',
    timeout: CONNECTION_TIMEOUT,
    keys: aliceKeys,
  })

  const bobKeys = ssbKeys.generate()
  let bob = createSbot({
    path: '/tmp/bob',
    timeout: CONNECTION_TIMEOUT,
    keys: bobKeys,
  })

  await Promise.all([
    pify(alice.publish)({ type: 'post', text: 'hello world' }),
    pify(bob.publish)({ type: 'post', text: 'hello world' }),
  ])
  t.pass('all peers have posted "hello world"')

  // wait for the delayed vector clocks
  await sleep(2000)

  t.pass('restarting')

  await Promise.all([pify(alice.close)(true), pify(bob.close)(true)])

  alice = createSbot({
    path: '/tmp/alice',
    timeout: CONNECTION_TIMEOUT,
    keys: aliceKeys,
  })

  bob = createSbot({
    path: '/tmp/bob',
    timeout: CONNECTION_TIMEOUT,
    keys: bobKeys,
  })

  // self replicate
  alice.ebt.request(alice.id, true)
  bob.ebt.request(bob.id, true)

  alice.ebt.request(bob.id, true)
  alice.ebt.block(alice.id, bob.id, false)
  t.pass('alice wants to replicate bob')

  await pify(bob.connect)(alice.getAddress())

  await sleep(REPLICATION_TIMEOUT)

  const clockAlice = await pify(alice.getVectorClock)()
  const clockBob = await pify(bob.getVectorClock)()

  u.log('A', u.countClock(clockAlice), 'B', u.countClock(clockBob))

  t.deepEqual(
    u.countClock(clockAlice),
    { total: 2, sum: 2 },
    'alice has both feeds'
  )
  t.deepEqual(
    u.countClock(clockBob),
    { total: 1, sum: 1 },
    'bob only has own feed'
  )

  await Promise.all([pify(alice.close)(true), pify(bob.close)(true)])
  t.end()
})
