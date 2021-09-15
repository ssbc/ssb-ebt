const tape = require('tape')
const crypto = require('crypto')
const SecretStack = require('secret-stack')
const sleep = require('util').promisify(setTimeout)
const pify = require('promisify-4loc')
const u = require('./misc/util')

const caps = require('ssb-caps')
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const ssbKeys = require('ssb-keys')
const SSBURI = require('ssb-uri2')
const bendyButt = require('ssb-bendy-butt')
const { where, author, type, toPromise } = require('ssb-db2/operators')

function createSSBServer() {
  return SecretStack({ appKey: caps.shs })
    .use(require('ssb-db2'))
    .use(require('ssb-db2/compat/ebt'))
    .use(require('ssb-meta-feeds'))
    .use(require('ssb-index-feed-writer'))
    .use(require('../'))
}

const CONNECTION_TIMEOUT = 500 // ms
const REPLICATION_TIMEOUT = 2 * CONNECTION_TIMEOUT

function getFreshDir(name) {
  const dir = '/tmp/test-format-' + name
  rimraf.sync(dir)
  mkdirp.sync(dir)
  return dir
}

const aliceDir = getFreshDir('alice')
let alice = createSSBServer().call(null, {
  path: aliceDir,
  timeout: CONNECTION_TIMEOUT,
  keys: u.keysFor('alice'),
})

const bobDir = getFreshDir('bob')
let bob = createSSBServer().call(null, {
  path: bobDir,
  timeout: CONNECTION_TIMEOUT,
  keys: u.keysFor('bob')
})

function getBBMsg(mainKeys) {
  // fake some keys
  const mfKeys = ssbKeys.generate()
  const classicUri = SSBURI.fromFeedSigil(mfKeys.id)
  const { type, /* format, */ data } = SSBURI.decompose(classicUri)
  const bendybuttUri = SSBURI.compose({ type, format: 'bendybutt-v1', data })
  mfKeys.id = bendybuttUri

  const content = {
    type: "metafeed/add/existing",
    feedpurpose: "main",
    subfeed: mainKeys.id,
    metafeed: mfKeys.id,
    tangles: {
      metafeed: {
        root: null,
        previous: null
      }
    }
  }

  const bbmsg = bendyButt.encodeNew(
    content,
    mainKeys,
    mfKeys,
    1,
    null,
    Date.now(),
    null
  )

  return bendyButt.decode(bbmsg)
}

const bendyButtMethods = require('../formats/bendy-butt')

// need them later
let aliceMFId
let bobMFId

tape('multiple formats', async (t) => {
  alice.ebt.registerFormat('bendybutt-v1', bendyButtMethods)
  bob.ebt.registerFormat('bendybutt-v1', bendyButtMethods)

  // self replicate
  alice.ebt.request(alice.id, true)
  bob.ebt.request(bob.id, true)

  // publish normal messages
  await Promise.all([
    pify(alice.db.publish)({ type: 'post', text: 'hello' }),
    pify(bob.db.publish)({ type: 'post', text: 'hello' })
  ])

  const aliceBBMsg = getBBMsg(alice.config.keys)
  const bobBBMsg = getBBMsg(bob.config.keys)

  aliceMFId = aliceBBMsg.author
  bobMFId = bobBBMsg.author

  // self replicate
  alice.ebt.request(aliceMFId, true)
  bob.ebt.request(bobMFId, true)

  await Promise.all([
    pify(alice.add)(aliceBBMsg),
    pify(bob.add)(bobBBMsg)
  ])

  alice.ebt.request(bob.id, true)
  alice.ebt.request(bobMFId, true)

  bob.ebt.request(alice.id, true)
  bob.ebt.request(aliceMFId, true)

  await pify(bob.connect)(alice.getAddress())

  await sleep(REPLICATION_TIMEOUT)
  t.pass('wait for replication to complete')

  const expectedClassicClock = {
    [alice.id]: 1,
    [bob.id]: 1
  }
  const expectedBBClock = {
    [aliceMFId]: 1,
    [bobMFId]: 1
  }

  const clockAlice = await pify(alice.ebt.clock)({ format: 'classic' })
  t.deepEqual(clockAlice, expectedClassicClock, 'alice correct classic clock')

  const bbClockAlice = await pify(alice.ebt.clock)({ format: 'bendybutt-v1' })
  t.deepEqual(bbClockAlice, expectedBBClock, 'alice correct bb clock')

  const clockBob = await pify(bob.ebt.clock)({ format: 'classic' })
  t.deepEqual(clockBob, expectedClassicClock, 'bob correct classic clock')

  const bbClockBob = await pify(bob.ebt.clock)({ format: 'bendybutt-v1' })
  t.deepEqual(bbClockBob, expectedBBClock, 'bob correct bb clock')

  await Promise.all([
    pify(alice.close)(true),
    pify(bob.close)(true)
  ])
  t.end()
})

tape('multiple formats restart', async (t) => {
  alice = createSSBServer().call(null, {
    path: aliceDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('alice'),
  })

  bob = createSSBServer().call(null, {
    path: bobDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('bob')
  })

  alice.ebt.registerFormat('bendybutt-v1', bendyButtMethods)
  bob.ebt.registerFormat('bendybutt-v1', bendyButtMethods)

  // self replicate
  alice.ebt.request(alice.id, true)
  alice.ebt.request(aliceMFId, true)
  bob.ebt.request(bob.id, true)
  bob.ebt.request(bobMFId, true)

  const expectedClassicClock = {
    [alice.id]: 1,
    [bob.id]: 1
  }
  const expectedBBClock = {
    [aliceMFId]: 1,
    [bobMFId]: 1
  }

  const clockAlice = await pify(alice.ebt.clock)({ format: 'classic' })
  t.deepEqual(clockAlice, expectedClassicClock, 'alice correct classic clock')

  const bbClockAlice = await pify(alice.ebt.clock)({ format: 'bendybutt-v1' })
  t.deepEqual(bbClockAlice, expectedBBClock, 'alice correct bb clock')

  const clockBob = await pify(bob.ebt.clock)({ format: 'classic' })
  t.deepEqual(clockBob, expectedClassicClock, 'bob correct classic clock')

  const bbClockBob = await pify(bob.ebt.clock)({ format: 'bendybutt-v1' })
  t.deepEqual(bbClockBob, expectedBBClock, 'bob correct bb clock')

  await Promise.all([
    pify(alice.close)(true),
    pify(bob.close)(true)
  ])
  t.end()
})

const carolDir = getFreshDir('carol')

tape('index format', async (t) => {
  const carol = createSSBServer().call(null, {
    path: carolDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('carol')
  })

  const daveDir = getFreshDir('dave')
  const dave = createSSBServer().call(null, {
    path: daveDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('dave')
  })

  const indexedMethods = require('../formats/indexed.js')

  carol.ebt.registerFormat('indexedfeed', indexedMethods)
  carol.ebt.registerFormat('bendybutt-v1', bendyButtMethods)
  dave.ebt.registerFormat('indexedfeed', indexedMethods)
  dave.ebt.registerFormat('bendybutt-v1', bendyButtMethods)

  const carolIndexId = (await pify(carol.indexFeedWriter.start)({
    author: carol.id, type: 'dog', private: false })).subfeed
  const daveIndexId = (await pify(dave.indexFeedWriter.start)({
    author: dave.id, type: 'dog', private: false })).subfeed

  // publish some messages
  const res = await Promise.all([
    pify(carol.db.publish)({ type: 'post', text: 'hello 2' }),
    pify(carol.db.publish)({ type: 'dog', name: 'Buff' }),
    pify(dave.db.publish)({ type: 'post', text: 'hello 2' }),
    pify(dave.db.publish)({ type: 'dog', name: 'Biff' })
  ])

  await sleep(2 * REPLICATION_TIMEOUT)
  t.pass('wait for index to complete')

  // get meta feed id to replicate
  const carolMetaMessages = await carol.db.query(
    where(type('metafeed/announce')),
    toPromise()
  )

  // get meta index feed
  const carolMetaIndexMessages = await carol.db.query(
    where(type('metafeed/add/derived')),
    toPromise()
  )

  // get meta feed id to replicate
  const daveMetaMessages = await dave.db.query(
    where(type('metafeed/announce')),
    toPromise()
  )
  
  // get meta index feed
  const daveMetaIndexMessages = await dave.db.query(
    where(type('metafeed/add/derived')),
    toPromise()
  )

  const carolMetaId = carolMetaMessages[0].value.content.metafeed
  const carolMetaIndexId = carolMetaIndexMessages[0].value.content.subfeed
  
  const daveMetaId = daveMetaMessages[0].value.content.metafeed
  const daveMetaIndexId = daveMetaIndexMessages[0].value.content.subfeed
  
  // self replicate
  carol.ebt.request(carol.id, true)
  carol.ebt.request(carolMetaId, true)
  carol.ebt.request(carolMetaIndexId, true)
  carol.ebt.request(carolIndexId, true, "indexedfeed")

  dave.ebt.request(dave.id, true)
  dave.ebt.request(daveMetaId, true)
  dave.ebt.request(daveMetaIndexId, true)
  dave.ebt.request(daveIndexId, true, "indexedfeed")

  // replication
  carol.ebt.request(daveMetaId, true)
  carol.ebt.request(daveMetaIndexId, true)
  dave.ebt.request(carolMetaId, true)
  dave.ebt.request(carolMetaIndexId, true)
  
  await pify(dave.connect)(carol.getAddress())

  await sleep(2 * REPLICATION_TIMEOUT)
  t.pass('wait for replication to complete')

  // debugging
  const carolIndexMessages = await carol.db.query(
    where(author(daveMetaIndexId)),
    toPromise()
  )
  t.equal(carolIndexMessages.length, 1, 'carol has dave meta index')

  const daveIndexMessages = await dave.db.query(
    where(author(carolMetaIndexId)),
    toPromise()
  )
  t.equal(daveIndexMessages.length, 1, 'dave has carol meta index')
  
  // now that we have meta feeds from the other peer we can replicate
  // index feeds

  carol.ebt.request(daveIndexId, true, "indexedfeed")
  dave.ebt.request(carolIndexId, true, "indexedfeed")

  await sleep(2 * REPLICATION_TIMEOUT)
  t.pass('wait for replication to complete')

  // we should only get the dog message and not second post
  const carolDaveMessages = await carol.db.query(
    where(author(dave.id)),
    toPromise()
  )
  t.equal(carolDaveMessages.length, 1, 'carol got dog message from dave')

  const daveCarolMessages = await dave.db.query(
    where(author(carol.id)),
    toPromise()
  )
  t.equal(daveCarolMessages.length, 1, 'dave got dog message from carol')

  const expectedIndexClock = {
    [carolIndexId]: 1,
    [daveIndexId]: 1
  }

  const indexClockCarol = await pify(carol.ebt.clock)({ format: 'indexedfeed' })
  t.deepEqual(indexClockCarol, expectedIndexClock, 'carol correct index clock')

  const indexClockDave = await pify(dave.ebt.clock)({ format: 'indexedfeed' })
  t.deepEqual(indexClockDave, expectedIndexClock, 'dave correct index clock')

  await Promise.all([
    pify(carol.close)(true),
    pify(dave.close)(true)
  ])
  t.end()
})

tape('sliced replication', async (t) => {
  alice = createSSBServer().call(null, {
    path: aliceDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('alice')
  })

  let carol = createSSBServer().call(null, {
    path: carolDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('carol')
  })

  await Promise.all([
    pify(alice.db.publish)({ type: 'post', text: 'hello2' }),
    pify(alice.db.publish)({ type: 'post', text: 'hello3' }),
  ])

  const slicedMethods = require('../formats/sliced')
  alice.ebt.registerFormat('slicedreplication', slicedMethods)
  carol.ebt.registerFormat('slicedreplication', slicedMethods)

  // self replicate
  alice.ebt.request(alice.id, true)
  alice.ebt.request(alice.id, true, "slicedreplication")
  carol.ebt.request(carol.id, true)

  await pify(carol.connect)(alice.getAddress())

  const clockAlice = await pify(alice.ebt.clock)({ format: 'classic' })
  t.equal(clockAlice[alice.id], 3, 'alice correct index clock')

  carol.ebt.setClockForSlicedReplication(alice.id,
                                         clockAlice[alice.id] - 2,
                                        "slicedreplication")
  carol.ebt.request(alice.id, true, "slicedreplication")

  await sleep(2 * REPLICATION_TIMEOUT)
  t.pass('wait for replication to complete')

  const carolMessages = await carol.db.query(
    where(author(alice.id)),
    toPromise()
  )
  t.equal(carolMessages.length, 2, 'latest 2 messages from alice')

  await Promise.all([
    pify(alice.close)(true),
    pify(carol.close)(true)
  ])
  t.end()
})
