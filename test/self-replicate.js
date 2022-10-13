const tape = require('tape')
const crypto = require('crypto')
const SecretStack = require('secret-stack')
const { promisify: pify } = require('util')

const u = require('./misc/util')

const sleep = pify(setTimeout)

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
  const msg2 = await pify(alice.publish)({ type: 'post', text: 'hello again' })

  // await pify(pub.publish)({ type: 'pub' })
  pub.add(msg.value, (err) => t.error(err))
  pub.add(msg2.value, (err) => t.error(err))

  aliceNew.ebt.request(alice.id, true)

  console.log('alice is connecting to pub')
  await pify(aliceNew.connect)(pub.getAddress())
  console.log('alice is requesting their feed')

  await new Promise((resolve, reject) => {
    setTimeout(() => resolve(), 5000)
  })

  // expect
  const aliceState1 = aliceNew.ebt.peerStatus(aliceNew.id)
  console.log(JSON.stringify(aliceState1, null, 2))
  t.equal(aliceState1.seq, 0, 'Alices vector clock on self is zero')
  t.equal(aliceState1.peers[pub.id].seq, 1, 'Alice sees pub has 1 message')

  // console.log({
  //   clockAlice: aliceNew.ebt.peerStatus(aliceNew.id),
  //   clockPub: pub.ebt.peerStatus(aliceNew.id)
  // })

  // wait for replication
  console.log('here')
  // await sleep(5000)
  console.log('here')

  console.log(
    'getting vector clocks. What are these? Idk. But the test race.js makes them seem important.'
  )

  const result = {
    clockAlice: aliceNew.ebt.peerStatus(aliceNew.id),
    clockPub: pub.ebt.peerStatus(aliceNew.id),
  }
  console.log(JSON.stringify(result, null, 2))

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

  alice.close()
  aliceNew.close()
  pub.close()

  t.end()
})
