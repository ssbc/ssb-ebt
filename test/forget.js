const tape = require('tape')
const crypto = require('crypto')
const SecretStack = require('secret-stack')
const fs = require('fs')
const path = require('path')
const os = require('os')
const sleep = require('util').promisify(setTimeout)
const pify = require('promisify-4loc')
const u = require('./misc/util')

const createSsbServer = SecretStack({
  caps: { shs: crypto.randomBytes(32).toString('base64') },
})
  .use(require('ssb-db2'))
  .use(require('ssb-db2/compat/ebt'))
  .use(require('../'))

const CONNECTION_TIMEOUT = 500 // ms
const REPLICATION_TIMEOUT = 2 * CONNECTION_TIMEOUT

const alice = createSsbServer({
  temp: 'test-delete-alice',
  timeout: CONNECTION_TIMEOUT,
  keys: u.keysFor('alice'),
})

const bob = createSsbServer({
  temp: 'test-delete-bob',
  timeout: CONNECTION_TIMEOUT,
  keys: u.keysFor('bob'),
})

const carla = createSsbServer({
  temp: 'test-delete-carla',
  timeout: CONNECTION_TIMEOUT,
  keys: u.keysFor('carla'),
})

tape('after forgetting a feed, replicate stream gives nothing', async (t) => {
  await Promise.all([
    pify(alice.db.publish)({ type: 'post', text: 'hello' }),
    pify(bob.db.publish)({ type: 'post', text: 'hello' }),
    pify(carla.db.publish)({ type: 'post', text: 'hello' }),
  ])

  // Self replicate
  alice.ebt.request(alice.id, true)
  bob.ebt.request(bob.id, true)
  carla.ebt.request(carla.id, true)

  // Alice <==> Bob
  alice.ebt.request(bob.id, true)
  bob.ebt.request(alice.id, true)

  // Carla <== Alice
  carla.ebt.request(alice.id, true)
  // Carla <== Bob
  carla.ebt.request(bob.id, true)

  const clockCarla1 = await pify(carla.ebt.clock)()
  t.deepEquals(clockCarla1, { [carla.id]: 1 }, 'carla clock ok')

  const rpcBobToAlice = await pify(bob.connect)(alice.getAddress())
  t.pass('bob connects to alice')

  await sleep(REPLICATION_TIMEOUT)
  t.pass('wait for alice and bob to sync')

  const clockAlice1 = await pify(alice.ebt.clock)()
  t.deepEquals(clockAlice1, { [alice.id]: 1, [bob.id]: 1 }, 'alice clock ok')

  const clockBob1 = await pify(bob.ebt.clock)()
  t.deepEquals(clockBob1, { [alice.id]: 1, [bob.id]: 1 }, 'bob clock ok')

  await pify(rpcBobToAlice.close)(true)
  t.pass('bob disconnects from alice')

  await sleep(REPLICATION_TIMEOUT)
  t.true(
    fs.existsSync(
      path.join(
        os.tmpdir(),
        'test-delete-bob',
        'ebt',
        alice.id.replace(/\//g, '_').replace('=', '')
      )
    ),
    'bob has ebt state for alice in disk'
  )

  bob.ebt.forget(alice.id)
  t.pass('bob forgets alice')

  await pify(bob.db.deleteFeed)(alice.id)
  t.pass("bob deletes alice's messages")

  t.false(
    fs.existsSync(
      path.join(
        os.tmpdir(),
        'test-delete-bob',
        'ebt',
        alice.id.replace(/\//g, '_').replace('=', '')
      )
    ),
    'bob does NOT have ebt state for alice in disk'
  )

  await sleep(REPLICATION_TIMEOUT)

  const clockBob2 = await pify(bob.ebt.clock)()
  t.deepEquals(clockBob2, { [bob.id]: 1 }, 'bob clock ok')

  const rpcBobToCarla = await pify(bob.connect)(carla.getAddress())
  t.pass('bob connects to carla')

  await sleep(REPLICATION_TIMEOUT)
  t.pass('wait for bob and carla to sync')

  const clockCarla2 = await pify(carla.ebt.clock)()
  t.deepEquals(clockCarla2, { [carla.id]: 1, [bob.id]: 1 }, 'carla clock ok')

  await pify(rpcBobToCarla.close)(true)
  t.pass('bob disconnects from carla')

  bob.ebt.request(alice.id, true)
  t.pass('bob unforgets alice')

  const rpcBobToAlice2 = await pify(bob.connect)(alice.getAddress())
  t.pass('bob connects to alice')

  await sleep(REPLICATION_TIMEOUT)
  t.pass('wait for alice and bob to sync')

  const clockBob3 = await pify(bob.ebt.clock)()
  t.deepEquals(clockBob3, { [alice.id]: 1, [bob.id]: 1 }, 'bob clock ok')

  await pify(rpcBobToAlice2.close)(true)
  t.pass('bob disconnects from alice')

  await Promise.all([
    pify(alice.close)(true),
    pify(bob.close)(true),
    pify(carla.close)(true),
  ])
  t.end()
})
