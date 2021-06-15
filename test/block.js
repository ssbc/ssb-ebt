const tape = require('tape')
const pull = require('pull-stream')
const crypto = require('crypto')
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

// alice, bob, and carol all follow each other,
// but then bob offends alice, and she blocks him.
// this means that:
//
// 1. when bob tries to connect to alice, she refuses.
// 2. alice never tries to connect to bob. (removed from peers)
// 3. carol will not give bob any, she will not give him any data from alice.

const CONNECTION_TIMEOUT = 500 // ms
const REPLICATION_TIMEOUT = 2 * CONNECTION_TIMEOUT

const alice = createSsbServer({
  temp: 'test-block-alice',
  timeout: CONNECTION_TIMEOUT,
  keys: u.keysFor('alice'),
  replicate: { legacy: false }
})

const bob = createSsbServer({
  temp: 'test-block-bob',
  timeout: CONNECTION_TIMEOUT,
  keys: u.keysFor('bob'),
  replicate: { legacy: false }
})

const carol = createSsbServer({
  temp: 'test-block-carol',
  timeout: CONNECTION_TIMEOUT,
  keys: u.keysFor('carol'),
  replicate: { legacy: false }
})

tape('alice blocks bob, and bob cannot connect to alice', async (t) => {
  t.plan(9)

  // in the beginning alice and bob follow each other
  // carol follows alice
  await Promise.all([
    pify(alice.publish)(u.follow(bob.id)),
    pify(bob.publish)(u.follow(alice.id)),
    pify(carol.publish)(u.follow(alice.id))
  ])

  const [rpcBobToAlice, msgAtBob, msgAtAlice] = await Promise.all([
    // replication will begin immediately.
    pify(bob.connect)(alice.getAddress()),

    // get the next messages that are replicated to alice and bob,
    // and check that these are the correct follow messages.
    u.readOnceFromDB(bob),
    u.readOnceFromDB(alice),
  ])

  // should be the alice's follow(bob) message.
  t.equal(msgAtBob.value.author, alice.id, 'bob received message from alice')
  t.equal(msgAtBob.value.content.contact, bob.id, 'received message is about bob')

  // should be the bob's follow(alice) message.
  t.equal(msgAtAlice.value.author, bob.id, 'alice received message from bob')
  t.equal(msgAtAlice.value.content.contact, alice.id, 'received message is about alice')

  // disconnect bob from alice
  await pify(rpcBobToAlice.close)(true)

  // alice blocks bob
  await pify(alice.publish)(u.block(bob.id))
  t.pass('alice published a block on bob')

  // get alice's follow graph
  const g = await pify(alice.friends.get)(null)
  t.equal(g[alice.id][bob.id], false, 'alice indicates she blocks bob')

  // since bob is blocked, he should not be able to connect to alice
  try {
    await pify(bob.connect)(alice.getAddress())
    t.fail('bob.connect succeeded but it should have failed')
  } catch (err) {
    t.match(
      err.message,
      /server hung up/,
      'bob is blocked, should fail to connect to alice'
    )
  }

  // but carol is allowed to connect, because she is not blocked
  const rpcCarolToAlice = await pify(carol.connect)(alice.getAddress())
  await sleep(REPLICATION_TIMEOUT)

  await pify(rpcCarolToAlice.close)(true)

  // carol has replicated with alice
  const clockCarol = await pify(carol.getVectorClock)()
  t.equal(clockCarol[alice.id], 2, 'carol replicated everything from alice')

  // alice does not follow carol, so didnt get data
  const clockAlice = await pify(alice.getVectorClock)()
  t.notOk(clockAlice[carol.id], 'alice did not replicate alice')

  t.end()
})

tape('carol does not replicate alice\'s data with bob', async (t) => {
  t.plan(3)
  // first, carol should have already replicated with alice.
  // emits this event when did not allow bob to get this data.
  const rpcBobToCarol = await pify(bob.connect)(carol.getAddress())
  await sleep(REPLICATION_TIMEOUT)

  await pify(rpcBobToCarol.close)(true)

  const clockBob = await pify(bob.getVectorClock)()
  t.equal(clockBob[alice.id], 1)

  // Although carol connected to bob, she doesn't follow him, and
  // neither does alice *anymore*, so carol does not replicate bob
  const clockCarol = await pify(carol.getVectorClock)()
  t.ok(clockCarol[alice.id], 'carol replicated alice')
  t.notOk(clockCarol[bob.id], 'carol did not replicate bob')

  t.end()
})

tape('alice does not replicate messages from bob, but carol does', async (t) => {
  u.log('**********************************************************')

  let friends = 0
  carol.friends.get(u.log)

  pull(
    carol.friends.createFriendStream({ meta: true, live: true }),
    pull.drain(function (v) {
      friends++
      u.log('************', v)
    })
  )

  await Promise.all([
    pify(alice.publish)(u.follow(carol.id)),
    pify(bob.publish)({ type: 'post', text: 'hello' }),
    pify(carol.publish)(u.follow(bob.id))
  ])

  const recv = { alice: 0, carol: 0 }

  // carol will receive: alice's recent follow and all of bob's (two) msgs
  // because carol is now following bob
  carol.post((msg) => recv.carol++, false)

  // alice will receive: all of carol's (two) msgs
  // because alice is now following carol
  alice.post((msg) => {
    recv.alice++
    t.equal(msg.value.author, carol.id, 'alice gets a msg from carol')
  }, false)

  const g = await pify(carol.friends.get)()
  t.ok(g[carol.id][bob.id])

  const [rpcCarolToAlice, rpcCarolToBob] = await Promise.all([
    pify(carol.connect)(alice.getAddress()),
    pify(carol.connect)(bob.getAddress()),
  ])

  await sleep(REPLICATION_TIMEOUT)

  await pify(rpcCarolToAlice.close)(true)
  await pify(rpcCarolToBob.close)(true)

  // Drain Carol's full log
  await new Promise((resolve, reject) => {
    pull(
      carol.createLogStream(),
      pull.collect(function (err, ary) {
        if (err) reject(err)
        else resolve(ary)
      }),
    )
  })

  const vclock = await pify(carol.getVectorClock)()
  t.equals(vclock[alice.id], 3)
  t.equals(vclock[bob.id], 2)
  t.equals(vclock[carol.id], 2)

  t.equals(recv.carol, 3)
  t.equals(recv.alice, 2)

  t.equal(friends, 3, "carol's createFriendStream has 3 peers")
  t.end()
})

// TODO test that bob is disconnected from alice if he is connected
//      and she blocks him.

// TODO test that blocks work in realtime. if alice blocks him
//      when he is already connected to alice's friend.

tape('teardown', async (t) => {
  await Promise.all([
    pify(alice.close)(true),
    pify(bob.close)(true),
    pify(carol.close)(true),
  ])
  t.end()
})
