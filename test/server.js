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
  .use(require('ssb-replicate'))
  .use(require('..'))
  .use(require('ssb-friends'))

const CONNECTION_TIMEOUT = 500
const REPLICATION_TIMEOUT = 2 * CONNECTION_TIMEOUT

tape('replicate between 3 peers', async (t) => {
  t.plan(3)

  const alice = createSsbServer({
    temp: 'server-alice',
    keys: ssbKeys.generate(),
    timeout: CONNECTION_TIMEOUT,
    replicate: { legacy: false },
    level: 'info'
  })
  const bob = createSsbServer({
    temp: 'server-bob',
    keys: ssbKeys.generate(),
    timeout: CONNECTION_TIMEOUT,
    replicate: { legacy: false },
    level: 'info'
  })
  const carol = createSsbServer({
    temp: 'server-carol',
    keys: ssbKeys.generate(),
    timeout: CONNECTION_TIMEOUT,
    replicate: { legacy: false },
    level: 'info'
  })

  // Wait for all bots to be ready
  await sleep(500)

  await Promise.all([
    // All peers publish "pub" of themselves
    pify(alice.publish)(u.pub(alice.getAddress())),
    pify(bob.publish)(u.pub(bob.getAddress())),
    pify(carol.publish)(u.pub(carol.getAddress())),

    // alice follows bob & carol
    pify(alice.publish)(u.follow(bob.id)),
    pify(alice.publish)(u.follow(carol.id)),

    // bob follows alice & carol
    pify(bob.publish)(u.follow(alice.id)),
    pify(bob.publish)(u.follow(carol.id)),

    // carol follows alice & bob
    pify(carol.publish)(u.follow(alice.id)),
    pify(carol.publish)(u.follow(bob.id)),
  ])

  const [connectionBA, connectionBC, connectionCA] = await Promise.all([
    pify(bob.connect)(alice.getAddress()),
    pify(bob.connect)(carol.getAddress()),
    pify(carol.connect)(alice.getAddress()),
  ])

  const expectedClock = {
    [alice.id]: 3,
    [bob.id]: 3,
    [carol.id]: 3,
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
