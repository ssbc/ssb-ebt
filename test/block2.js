const tape = require('tape')
const crypto = require('crypto')
const ssbKeys = require('ssb-keys')
const SecretStack = require('secret-stack')
const pify = require('promisify-4loc')
const sleep = require('util').promisify(setTimeout)
const u = require('./misc/util')

const createSsbServer = SecretStack({
  caps: { shs: crypto.randomBytes(32).toString('base64') }
})
  .use(require('ssb-db'))
  .use(require('ssb-replicate'))
  .use(require('ssb-friends'))
  .use(require('..'))

const CONNECTION_TIMEOUT = 500
const REPLICATION_TIMEOUT = 2 * CONNECTION_TIMEOUT

const alice = createSsbServer({
  temp: 'test-block-alice',
  timeout: CONNECTION_TIMEOUT,
  keys: ssbKeys.generate(),
  replicate: { legacy: false },
})

const bob = createSsbServer({
  temp: 'test-block-bob',
  timeout: CONNECTION_TIMEOUT,
  keys: ssbKeys.generate(),
  replicate: { legacy: false },
})

tape('alice blocks bob while he is connected, she should disconnect him', async (t) => {
  // in the beginning alice and bob follow each other
  await Promise.all([
    pify(alice.publish)(u.follow(bob.id)),
    pify(bob.publish)(u.follow(alice.id))
  ])

  const [, msgAtBob] = await Promise.all([
    // replication will begin immediately.
    pify(bob.connect)(alice.getAddress()),
    u.readOnceFromDB(bob),
  ])

  // should be the alice's follow(bob) message.
  u.log('BOB RECV', msgAtBob)
  t.equal(msgAtBob.value.author, alice.id, 'bob got message from alice')
  t.equal(msgAtBob.value.content.contact, bob.id, 'message received is about bob')
  t.equal(msgAtBob.value.content.following, true, 'message received is a follow')

  await pify(alice.publish)(u.block(bob.id))

  await sleep(REPLICATION_TIMEOUT)

  const vclock = await pify(bob.getVectorClock)()
  u.log(vclock)
  t.equal(vclock[alice.id], 1, 'bob replicated at most seq 1 from alice')

  await Promise.all([
    pify(alice.close)(true),
    pify(bob.close)(true),
  ])
  t.end()
})
