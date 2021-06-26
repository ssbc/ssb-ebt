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
  keys: u.keysFor('alice')
})

const bob = createSsbServer({
  temp: 'test-block-bob',
  timeout: CONNECTION_TIMEOUT,
  keys: u.keysFor('bob')
})

tape('alice replicates bob', async (t) => {
  await Promise.all([
    pify(alice.publish)({ type: 'post', text: 'hello' }),
    pify(alice.publish)({ type: 'post', text: 'world' }),
    pify(bob.publish)({ type: 'post', text: 'hello' }),
    pify(bob.publish)({ type: 'post', text: 'world' })
  ])

  // Self replicate
  alice.ebt.request(alice.id, true)
  bob.ebt.request(bob.id, true)

  alice.ebt.request(bob.id, true)
  alice.ebt.block(alice.id, bob.id, false)
  t.pass('alice wants bob\'s data')

  bob.ebt.request(alice.id, true)
  bob.ebt.block(bob.id, alice.id, false)
  t.pass('bob wants alice\'s data')

  const [rpcBobToAlice, msgAtBob, msgAtAlice] = await Promise.all([
    pify(bob.connect)(alice.getAddress()),
    u.readOnceFromDB(bob, REPLICATION_TIMEOUT),
    u.readOnceFromDB(alice, REPLICATION_TIMEOUT)
  ])

  t.equals(msgAtAlice.value.author, bob.id, 'alice has a msg from bob')
  t.equals(msgAtBob.value.author, alice.id, 'bob has a msg from alice')

  await pify(rpcBobToAlice.close)(true)
})

tape('ssb.progress', t => {
  const p = alice.progress()
  t.ok(p, 'progress')
  t.ok(p.ebt, 'progress.ebt')
  t.true(p.ebt.current > 0, 'progress.ebt.current')
  t.true(p.ebt.target > 0, 'progress.ebt.target')
  t.equals(p.ebt.current, p.ebt.target, 'current and target match')
  t.end()
})

tape('ssb.ebt.peerStatus', t => {
  const s = alice.ebt.peerStatus(bob.id)
  t.ok(s, 'response is an object')
  t.equals(s.id, bob.id, 'response.id is correct')
  t.equals(s.seq, 2, 'response.id is correct')
  t.end()
})

tape('silly ssb.ebt.request', t => {
  t.doesNotThrow(() => {
    alice.ebt.request('not a feed id', true)
  })
  t.end()
})

tape('silly ssb.ebt.block', t => {
  t.doesNotThrow(() => {
    alice.ebt.block(bob.id, 'not a feed id', true)
  })
  t.doesNotThrow(() => {
    alice.ebt.block('not a feed id', bob.id, true)
  })
  t.end()
})

tape('teardown', async (t) => {
  await Promise.all([
    pify(alice.close)(true),
    pify(bob.close)(true)
  ])
  t.end()
})
