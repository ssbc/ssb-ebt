const tape = require('tape')
const pull = require('pull-stream')
const crypto = require('crypto')
const ssbKeys = require('ssb-keys')
const SecretStack = require('secret-stack')
const pify = require('promisify-4loc')
const sleep = require('util').promisify(setTimeout)

const createSsbServer = SecretStack({
  caps: { shs: crypto.randomBytes(32).toString('base64') }
})
  .use(require('ssb-db'))
  .use(require('..'))

function createHistoryStream (sbot, opts) {
  return pull(
    sbot.createLogStream({ keys: false, live: opts.live }),
    pull.filter((msg) => msg.author === opts.id)
  )
}

const CONNECTION_TIMEOUT = 500 // ms
const REPLICATION_TIMEOUT = 2 * CONNECTION_TIMEOUT

tape('replicate between 2 peers', async (t) => {
  const alice = createSsbServer({
    temp: 'test-alice',
    timeout: CONNECTION_TIMEOUT,
    keys: ssbKeys.generate()
  })

  const bob = createSsbServer({
    temp: 'test-bob',
    timeout: CONNECTION_TIMEOUT,
    keys: ssbKeys.generate()
  })

  // Self replicate
  alice.ebt.request(alice.id, true)
  bob.ebt.request(bob.id, true)

  alice.ebt.request(bob.id, true)
  alice.ebt.block(alice.id, bob.id, false)
  bob.ebt.request(alice.id, true)
  bob.ebt.block(bob.id, alice.id, false)
  t.pass('alice and bob want to replicate each other')

  alice.connect(bob.getAddress(), (err) => {
    if (err) t.fail(err)
  })

  // Collect all live msgs replicated from alice to bob's DB
  const hotMsgs = []
  pull(
    createHistoryStream(bob, { id: alice.id, live: true }),
    pull.drain(function (data) {
      hotMsgs.push(data)
    })
  )

  for (let i = 0; i < 10; i++) {
    await pify(alice.publish)({ type: 'test', value: new Date() })
    await sleep(200)
  }

  await sleep(REPLICATION_TIMEOUT)

  const coldMsgs = await new Promise((resolve, reject) => {
    pull(
      createHistoryStream(bob, { id: alice.id, live: false }),
      pull.collect(function (err, msgs) {
        if (err) reject(err)
        else resolve(msgs)
      })
    )
  })

  t.equal(coldMsgs.length, 10)
  t.deepEqual(hotMsgs, coldMsgs)

  await Promise.all([
    pify(alice.close)(true),
    pify(bob.close)(true)
  ])
  t.end()
})
