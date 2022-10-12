const tape = require('tape')
const crypto = require('crypto')
const SecretStack = require('secret-stack')
const pify = require('promisify-4loc')
const sleep = require('util').promisify(setTimeout)
const u = require('./misc/util')

tape.only('alice restores from pub', async (t) => {
  const createSsbServer = SecretStack({
    caps: { shs: crypto.randomBytes(32).toString('base64') },
  })
    .use(require('ssb-db'))
    .use(require('../'))

  const CONNECTION_TIMEOUT = 500 // ms
  const REPLICATION_TIMEOUT = 2 * CONNECTION_TIMEOUT

  const alice = createSsbServer({
    temp: 'test-self-replicate-alice',
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('alice'),
  })
  console.log('alice key: ', u.keysFor('alice').public)

  const aliceNew = createSsbServer({
    temp: 'test-self-replicate-alice-new',
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('alice'),
  })

  const pub = createSsbServer({
    temp: 'test-self-replicate-pub',
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('pub'),
  })

  console.log('pub key: ', u.keysFor('pub').public)

  const msg = await pify(alice.publish)({ type: 'post', text: 'hello!' })
  alice.close()

  // await pify(pub.publish)({ type: 'pub' })
  pub.add(msg.value, (err) => t.error(err))

  console.log('alice is connecting to pub')
  await pify(aliceNew.connect)(pub.getAddress())
  console.log('alice is requesting their feed')
  aliceNew.ebt.request(alice.id, true)

  // wait for replication
  await sleep(5000)

  console.log(
    'getting vector clocks. What are these? Idk. But the test race.js makes them seem important.'
  )

  // MIX - the test appears to hang here
  const clockAlice = await pify(aliceNew.getVectorClock)()
  const clockBob = await pify(bob.getVectorClock)()

  console.log('A', u.countClock(clockAlice), 'B', u.countClock(clockBob))

  // TODO: Assert that alice got their own feed

  // t.deepEqual(
  //   u.countClock(clockAlice),
  //   { total: 2, sum: 2 },
  //   'alice has both feeds'
  // )
  // t.deepEqual(
  //   u.countClock(clockBob),
  //   { total: 1, sum: 1 },
  //   'bob only has own feed'
  // )

  aliceNew.close()
  pub.close()

  t.end()
})
