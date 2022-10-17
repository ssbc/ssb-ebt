const tape = require('tape')
const crypto = require('crypto')
const SecretStack = require('secret-stack')
const { promisify: pify } = require('util')

const u = require('./misc/util')

const sleep = pify(setTimeout)
const caps = {
  shs: crypto.randomBytes(32).toString('base64'),
}

const CONNECTION_TIMEOUT = 500 // ms
const REPLICATION_TIMEOUT = 2 * CONNECTION_TIMEOUT

function Server(name, opts = {}) {
  const stack = SecretStack({ caps }).use(require('ssb-db')).use(require('../'))

  return stack({
    temp: `test-self-replicate-${name}`, // ssb-db only
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor(name),
    ...opts,
  })
}

tape('alice restores from pub', async (t) => {
  const aliceKeys = u.keysFor('alice')

  const alice = Server('alice', { keys: aliceKeys })
  const pub = Server('pub')

  await pify(alice.publish)({ type: 'post', text: 'hello!' })
  await pify(alice.publish)({ type: 'post', text: 'hello again' })
  await pify(pub.publish)({ type: 'pub', text: 'i am pub' }) // needed to provide clock info

  t.deepEqual(
    alice.ebt.peerStatus(alice.id),
    {
      id: alice.id,
      seq: 2,
      peers: {},
    },
    'alice: correct local state'
  )
  t.deepEqual(
    pub.ebt.peerStatus(alice.id),
    {
      id: alice.id,
      seq: undefined,
      peers: {},
    },
    'pub: has nothing on alice'
  )

  // pub set up to want alice
  pub.ebt.request(alice.id, true)
  // pub.ebt.request(pub.id, true) // NOT needed
  // alice.ebt.request(pub.id, true) // NOT needed
  alice.ebt.request(alice.id, true) // :fire: MYSTERY - replication fails without this
  await pify(alice.connect)(pub.getAddress())

  await sleep(REPLICATION_TIMEOUT)

  t.deepEqual(
    await pify(pub.ebt.clock)(),
    {
      [alice.id]: 2,
      [pub.id]: 1,
    },
    "pub: clock shows has alice's messages"
  )
  t.deepEqual(
    pub.ebt.peerStatus(alice.id),
    {
      id: alice.id,
      seq: 2,
      peers: {
        [alice.id]: {
          seq: 2,
          replicating: {
            requested: 0,
            rx: true,
            sent: 2,
            tx: true,
          },
        },
      },
    },
    "pub: has replicated alice's messages"
  )

  // alice "dies"
  await pify(alice.close)(true).catch(t.error)
  alice.ebt = 'nope'

  // aliceNew is created from same keys
  const aliceNew = Server('aliceNew', { keys: aliceKeys })
  t.equal(aliceNew.id, alice.id, 'aliceNew has the same id')

  // try to restore from pub
  aliceNew.ebt.request(alice.id, true)
  await pify(aliceNew.connect)(pub.getAddress()).catch(t.error)

  await sleep(REPLICATION_TIMEOUT)

  t.deepEqual(
    await pify(aliceNew.ebt.clock)(),
    {
      [aliceNew.id]: 2,
    },
    "aliceNew: clock shows has replicated alice's messages"
  )
  t.deepEqual(
    aliceNew.ebt.peerStatus(alice.id),
    {
      id: aliceNew.id,
      seq: 2,
      peers: {
        [pub.id]: {
          seq: 2,
          replicating: {
            tx: false,
            rx: true,
            requested: 0,
            sent: 2,
          },
        },
      },
    },
    'aliceNew: peerStatus correct'
  )

  // aliceNew publishe a new message
  await pify(aliceNew.publish)({ type: 'boop' })

  await sleep(REPLICATION_TIMEOUT)

  t.deepEqual(
    pub.ebt.peerStatus(alice.id),
    {
      id: alice.id,
      seq: 3,
      peers: {
        [alice.id]: {
          seq: 3,
          replicating: {
            tx: false,
            rx: true,
            sent: 3,
            requested: 2,
          },
        },
      },
    },
    'pub: peerStatus shows new messages from aliceNew'
  )
  t.deepEqual(
    await pify(pub.ebt.clock)(),
    {
      [pub.id]: 1,
      [alice.id]: 3,
    },
    'pub: clock agrees'
  )

  console.time('shutdown')
  await Promise.all([pify(aliceNew.close)(true), pify(pub.close)(true)]).catch(
    t.error
  )
  console.timeEnd('shutdown')

  t.end()
})
