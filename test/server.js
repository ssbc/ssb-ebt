const tape = require('tape')
const crypto = require('crypto')
const ssbKeys = require('ssb-keys')
const SecretStack = require('secret-stack')
const pify = require('promisify-4loc')
const sleep = require('util').promisify(setTimeout)
const u = require('./misc/util')

// create 3 servers
// give them all pub servers (on localhost)
// and get them to follow each other...

const createSsbServer = SecretStack({
  caps: { shs: crypto.randomBytes(32).toString('base64') }
})
  .use(require('ssb-db'))
  .use(require('..'))

const CONNECTION_TIMEOUT = 500 // ms
const REPLICATION_TIMEOUT = 2 * CONNECTION_TIMEOUT

tape('replicate between 3 peers', async (t) => {
  t.plan(3)

  const alice = createSsbServer({
    temp: 'server-alice',
    keys: ssbKeys.generate(),
    timeout: CONNECTION_TIMEOUT,
    level: 'info'
  })
  const bob = createSsbServer({
    temp: 'server-bob',
    keys: ssbKeys.generate(),
    timeout: CONNECTION_TIMEOUT,
    level: 'info'
  })
  const carol = createSsbServer({
    temp: 'server-carol',
    keys: ssbKeys.generate(),
    timeout: CONNECTION_TIMEOUT,
    level: 'info'
  })

  // Wait for all bots to be ready
  await sleep(500)

  await Promise.all([
    // All peers publish two msgs each
    pify(alice.publish)({ type: 'post', text: 'hello' }),
    pify(alice.publish)({ type: 'post', text: 'world' }),

    pify(bob.publish)({ type: 'post', text: 'hello' }),
    pify(bob.publish)({ type: 'post', text: 'world' }),

    pify(carol.publish)({ type: 'post', text: 'hello' }),
    pify(carol.publish)({ type: 'post', text: 'world' }),
  ])

  // Self replicate
  alice.ebt.request(alice.id, true)
  bob.ebt.request(bob.id, true)
  carol.ebt.request(carol.id, true)

  // alice wants to replicate bob & carol
  alice.ebt.request(bob.id, true)
  alice.ebt.block(alice.id, bob.id, false)
  alice.ebt.request(carol.id, true)
  alice.ebt.block(alice.id, carol.id, false)

  // bob wants to replicate alice & carol
  bob.ebt.request(alice.id, true)
  bob.ebt.block(bob.id, alice.id, false)
  bob.ebt.request(carol.id, true)
  bob.ebt.block(bob.id, carol.id, false)

  // carol wants to replicate alice & bob
  carol.ebt.request(alice.id, true)
  carol.ebt.block(carol.id, alice.id, false)
  carol.ebt.request(bob.id, true)
  carol.ebt.block(carol.id, bob.id, false)

  const [connectionBA, connectionBC, connectionCA] = await Promise.all([
    pify(bob.connect)(alice.getAddress()),
    pify(bob.connect)(carol.getAddress()),
    pify(carol.connect)(alice.getAddress()),
  ])

  const expectedClock = {
    [alice.id]: 2,
    [bob.id]: 2,
    [carol.id]: 2,
  }

  await sleep(REPLICATION_TIMEOUT)

  const [clockAlice, clockBob, clockCarol] = await Promise.all([
    pify(alice.getVectorClock)(),
    pify(bob.getVectorClock)(),
    pify(carol.getVectorClock)(),
  ])

  t.deepEqual(clockAlice, expectedClock, 'alice\'s clock is correct')
  t.deepEqual(clockBob, expectedClock, 'bob\'s clock is correct')
  t.deepEqual(clockCarol, expectedClock, 'carol\'s clock is correct')

  await Promise.all([
    pify(connectionBA.close)(true),
    pify(connectionBC.close)(true),
    pify(connectionCA.close)(true),
  ])

  await Promise.all([
    pify(alice.close)(true),
    pify(bob.close)(true),
    pify(carol.close)(true)
  ])

  t.end()
})
