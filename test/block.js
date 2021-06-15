const tape = require('tape')
const crypto = require('crypto')
const SecretStack = require('secret-stack')
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
  temp: 'test-block-alice',
  timeout: CONNECTION_TIMEOUT,
  keys: u.keysFor('alice'),
})

const bob = createSsbServer({
  temp: 'test-block-bob',
  timeout: CONNECTION_TIMEOUT,
  keys: u.keysFor('bob'),
})

tape('alice blocks bob, then unblocks', async (t) => {
  await Promise.all([
    pify(alice.publish)({ type: 'post', text: 'hello' }),
    pify(bob.publish)({ type: 'post', text: 'hello' }),
  ])

  // Self replicate
  alice.ebt.request(alice.id, true)
  bob.ebt.request(bob.id, true)

  alice.ebt.request(bob.id, false)
  alice.ebt.block(alice.id, bob.id, true)
  t.pass('alice does not want bob\'s data')

  bob.ebt.request(alice.id, true)
  bob.ebt.block(bob.id, alice.id, false)
  t.pass('bob wants alice\'s data')

  try {
    const [rpcBobToAlice, msgAtBob, msgAtAlice] = await Promise.all([
      pify(bob.connect)(alice.getAddress()),
      u.readOnceFromDB(bob, REPLICATION_TIMEOUT),
      u.readOnceFromDB(alice, REPLICATION_TIMEOUT),
    ])
    t.fail('replication should not succeed')
  } catch (err) {
    t.match(err.message, /readOnceFromDB timed out/, 'db reading timed out')
  }

  const clockAlice = await pify(alice.getVectorClock)()
  t.notOk(clockAlice[bob.id], 'alice did not replicate bob')

  // TODO: shouldn't bob be forbidden to replicate alice???
  const clockBob = await pify(bob.getVectorClock)()
  t.ok(clockBob[bob.id], 'bob replicated alice')

  alice.ebt.request(bob.id, true)
  alice.ebt.block(alice.id, bob.id, false)
  t.pass('alice now wants bob\'s data')

  // Silly idempotent operation just to increase test coverage
  alice.ebt.block(alice.id, bob.id, false)

  const [rpcBobToAlice, msgAtAlice] = await Promise.all([
    pify(bob.connect)(alice.getAddress()),
    u.readOnceFromDB(alice, REPLICATION_TIMEOUT),
  ])

  t.equals(msgAtAlice.value.author, bob.id, 'alice has a msg from bob')

  const clockAlice2 = await pify(alice.getVectorClock)()
  t.ok(clockAlice2[bob.id], 'alice replicated bob')

  await pify(rpcBobToAlice.close)(true)

  await Promise.all([
    pify(alice.close)(true),
    pify(bob.close)(true),
  ])
  t.end()
})
