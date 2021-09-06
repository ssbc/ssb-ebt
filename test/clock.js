const tape = require('tape')
const crypto = require('crypto')
const SecretStack = require('secret-stack')
const sleep = require('util').promisify(setTimeout)
const pify = require('promisify-4loc')
const u = require('./misc/util')

const createSsbServer = SecretStack({
  caps: { shs: crypto.randomBytes(32).toString('base64') }
})
  .use(require('ssb-db'))
  .use(require('../'))

const CONNECTION_TIMEOUT = 500 // ms
const REPLICATION_TIMEOUT = 2 * CONNECTION_TIMEOUT

const alice = createSsbServer({
  temp: 'test-clock-alice',
  timeout: CONNECTION_TIMEOUT,
  keys: u.keysFor('alice')
})

const bob = createSsbServer({
  temp: 'test-clock-bob',
  timeout: CONNECTION_TIMEOUT,
  keys: u.keysFor('bob')
})

tape('clock works', async (t) => {
  await Promise.all([
    pify(alice.publish)({ type: 'post', text: 'hello' }),
    pify(bob.publish)({ type: 'post', text: 'hello' })
  ])

  const clockAlice = await pify(alice.ebt.clock)()
  t.equal(clockAlice[alice.id], 1, 'self clock')

  // Self replicate
  alice.ebt.request(alice.id, true)
  bob.ebt.request(bob.id, true)

  alice.ebt.request(bob.id, true)
  bob.ebt.request(alice.id, true)

  await pify(bob.connect)(alice.getAddress())

  await sleep(REPLICATION_TIMEOUT)
  t.pass('wait for replication to complete')

  const clockAliceAfter = await pify(alice.ebt.clock)()
  t.equal(clockAliceAfter[alice.id], 1, 'clock ok')
  t.equal(clockAliceAfter[bob.id], 1, 'clock ok')

  const clockBobAfter = await pify(bob.ebt.clock)()
  t.equal(clockBobAfter[alice.id], 1, 'clock ok')
  t.equal(clockBobAfter[bob.id], 1, 'clock ok')
  
  await pify(alice.publish)({ type: 'post', text: 'hello again' }),

  await sleep(REPLICATION_TIMEOUT)
  t.pass('wait for replication to complete')

  const clockAliceAfter2 = await pify(alice.ebt.clock)()
  t.equal(clockAliceAfter2[alice.id], 2, 'clock ok')

  const clockBobAfter2 = await pify(bob.ebt.clock)()
  t.equal(clockBobAfter2[alice.id], 2, 'clock ok')
  
  await Promise.all([
    pify(alice.close)(true),
    pify(bob.close)(true)
  ])
  t.end()
})
