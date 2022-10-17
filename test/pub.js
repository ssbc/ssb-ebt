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
    temp: `test-pub-replicate-${name}`, // ssb-db only
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor(name),
    ...opts,
  })
}

tape('Pub replicates Alice', async (t) => {
  const aliceKeys = u.keysFor('alice')

  const alice = Server('alice', { keys: aliceKeys })
  const pub = Server('pub')

  await pify(alice.publish)({ type: 'post', text: 'hello!' })
  await pify(alice.publish)({ type: 'post', text: 'hello again' })

  // Pub set up to want Alice's feed
  pub.ebt.request(alice.id, true)
  // alice.ebt.request(alice.id, true) // MYSTERY - replication fails without this

  // Alice connects (as Client) to Pub
  await pify(alice.connect)(pub.getAddress())

  await sleep(REPLICATION_TIMEOUT)
  t.deepEqual(
    await pify(pub.ebt.clock)(),
    {
      [alice.id]: 2,
    },
    "pub: clock shows has alice's messages"
  )

  await Promise.all([pify(alice.close)(true), pify(pub.close)(true)]).catch(
    t.error
  )

  t.end()
})
