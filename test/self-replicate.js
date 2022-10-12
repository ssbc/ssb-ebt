const tape = require('tape')
const crypto = require('crypto')
const SecretStack = require('secret-stack')
const pify = require('promisify-4loc')
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

  const msg = await pify(alice.publish)({ type: 'post', text: 'hello!' })
  alice.close()

  // await pify(pub.publish)({ type: 'pub' })
  pub.add(msg.value, (err) => t.error(err))

  await pify(aliceNew.connect)(pub.getAddress())

  await new Promise((resolve) => setTimeout(resolve, 5000))

  aliceNew.close()
  pub.close()

  t.end()
})
