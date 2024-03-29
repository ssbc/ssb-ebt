const tape = require('tape')
const SecretStack = require('secret-stack')
const sleep = require('util').promisify(setTimeout)
const pify = require('promisify-4loc')
const u = require('./misc/util')

const caps = require('ssb-caps')
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const ssbKeys = require('ssb-keys')
const bendyButt = require('ssb-bendy-butt/format')
const butt2 = require('ssb-buttwoo/format')
const { where, author, type, toPromise } = require('ssb-db2/operators')

function createSSBServer() {
  return SecretStack({ appKey: caps.shs })
    .use(require('ssb-db2'))
    .use(require('ssb-db2/compat/ebt'))
    .use(require('ssb-buttwoo'))
    .use(require('ssb-bendy-butt'))
    .use(require('ssb-meta-feeds'))
    .use(require('ssb-index-feeds'))
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
let alice

const bobDir = getFreshDir('bob')
let bob

const butt2Methods = require('../formats/buttwoo')

tape('multiple formats buttwoo', async (t) => {
  alice = createSSBServer().call(null, {
    path: aliceDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('alice'),
  })

  bob = createSSBServer().call(null, {
    path: bobDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('bob'),
  })

  alice.ebt.registerFormat(butt2Methods)
  bob.ebt.registerFormat(butt2Methods)

  // self replicate
  alice.ebt.request(alice.id, true)
  bob.ebt.request(bob.id, true)

  const hmac = null

  const aliceButtKeys = ssbKeys.generate(null, 'alice', 'buttwoo-v1')
  const aliceContent = { type: 'post', text: 'Hello world from Alice' }

  const butt2Msg = butt2.newNativeMsg({
    keys: aliceButtKeys,
    content: aliceContent,
    previous: null,
    timestamp: +new Date(),
    tag: butt2.tags.SSB_FEED,
    hmac,
  })
  const msgKeyBFE = butt2.getMsgId(butt2Msg)

  // subfeed
  const butt2Msg2 = butt2.newNativeMsg({
    keys: aliceButtKeys,
    content: aliceContent,
    parent: msgKeyBFE,
    previous: null,
    timestamp: +new Date(),
    tag: butt2.tags.SSB_FEED,
    hmac,
  })
  const msgKeyBFE2 = butt2.getMsgId(butt2Msg2)

  const bobButtKeys = ssbKeys.generate(null, 'bob', 'buttwoo-v1')
  const bobContent = { type: 'post', text: 'Hello world from Bob' }

  const butt2Msg3 = butt2.newNativeMsg({
    keys: bobButtKeys,
    content: bobContent,
    previous: null,
    timestamp: +new Date(),
    tag: butt2.tags.SSB_FEED,
    hmac,
  })
  const msgKeyBFE3 = butt2.getMsgId(butt2Msg3)

  const feedformat = alice.db.findFeedFormatByName('buttwoo-v1')

  const aliceButtId = feedformat.getFeedId(butt2Msg)
  const aliceSubFeedId = feedformat.getFeedId(butt2Msg2)
  const bobButtId = feedformat.getFeedId(butt2Msg3)

  // self replicate
  alice.ebt.request(aliceButtId, true)
  alice.ebt.request(aliceSubFeedId, true)
  bob.ebt.request(bobButtId, true)

  const opts = { encoding: 'bipf', feedFormat: 'buttwoo-v1' }

  await Promise.all([
    pify(alice.db.add)(butt2Msg, opts),
    pify(alice.db.add)(butt2Msg2, opts),
    pify(bob.db.add)(butt2Msg3, opts),
  ])

  alice.ebt.request(bob.id, true)
  alice.ebt.request(bobButtId, true)

  bob.ebt.request(alice.id, true)
  bob.ebt.request(aliceButtId, true)
  bob.ebt.request(aliceSubFeedId, true)

  await pify(bob.connect)(alice.getAddress())

  await sleep(REPLICATION_TIMEOUT)
  t.pass('wait for replication to complete')

  const expectedClassicClock = {}
  const expectedButt2Clock = {
    [aliceButtId]: 1,
    [aliceSubFeedId]: 1,
    [bobButtId]: 1,
  }

  /*
  const results = await alice.db.query(toPromise())
  console.log(results)
  */

  const clockAlice = await pify(alice.ebt.clock)({ format: 'classic' })
  t.deepEqual(clockAlice, expectedClassicClock, 'alice correct classic clock')

  const butt2ClockAlice = await pify(alice.ebt.clock)({ format: 'buttwoo-v1' })
  t.deepEqual(butt2ClockAlice, expectedButt2Clock, 'alice correct butt2 clock')

  const clockBob = await pify(bob.ebt.clock)({ format: 'classic' })
  t.deepEqual(clockBob, expectedClassicClock, 'bob correct classic clock')

  const butt2ClockBob = await pify(bob.ebt.clock)({ format: 'buttwoo-v1' })
  t.deepEqual(butt2ClockBob, expectedButt2Clock, 'bob correct butt2 clock')

  await Promise.all([pify(alice.close)(true), pify(bob.close)(true)])
  t.end()
})

function getBBMsg(mainKeys) {
  // fake some keys
  const mfKeys = ssbKeys.generate(null, null, 'bendybutt-v1')

  const content = {
    type: 'metafeed/add/existing',
    feedpurpose: 'main',
    subfeed: mainKeys.id,
    metafeed: mfKeys.id,
    tangles: {
      metafeed: {
        root: null,
        previous: null,
      },
    },
  }

  const bbmsg = bendyButt.newNativeMsg({
    content,
    contentKeys: mainKeys,
    keys: mfKeys,
    previous: null,
    timestamp: +Date.now(),
    hmacKey: null,
  })

  return bbmsg
}

const bendyButtMethods = require('../formats/bendy-butt')

// need them later
let aliceMFId
let bobMFId

tape('multiple formats', async (t) => {
  alice = createSSBServer().call(null, {
    path: aliceDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('alice'),
  })

  bob = createSSBServer().call(null, {
    path: bobDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('bob'),
  })

  alice.ebt.registerFormat(bendyButtMethods)
  bob.ebt.registerFormat(bendyButtMethods)

  // self replicate
  alice.ebt.request(alice.id, true)
  bob.ebt.request(bob.id, true)

  // publish normal messages
  await Promise.all([
    pify(alice.db.publish)({ type: 'post', text: 'hello' }),
    pify(bob.db.publish)({ type: 'post', text: 'hello' }),
  ])

  const aliceBBMsg = getBBMsg(alice.config.keys)
  const bobBBMsg = getBBMsg(bob.config.keys)

  aliceMFId = bendyButt.fromNativeMsg(aliceBBMsg).author
  bobMFId = bendyButt.fromNativeMsg(bobBBMsg).author

  // self replicate
  alice.ebt.request(aliceMFId, true)
  bob.ebt.request(bobMFId, true)

  await Promise.all([pify(alice.add)(aliceBBMsg), pify(bob.add)(bobBBMsg)])

  alice.ebt.request(bob.id, true)
  alice.ebt.request(bobMFId, true)

  bob.ebt.request(alice.id, true)
  bob.ebt.request(aliceMFId, true)

  await pify(bob.connect)(alice.getAddress())

  await sleep(REPLICATION_TIMEOUT)
  t.pass('wait for replication to complete')

  const expectedClassicClock = {
    [alice.id]: 1,
    [bob.id]: 1,
  }
  const expectedBBClock = {
    [aliceMFId]: 1,
    [bobMFId]: 1,
  }

  const clockAlice = await pify(alice.ebt.clock)({ format: 'classic' })
  t.deepEqual(clockAlice, expectedClassicClock, 'alice correct classic clock')

  const bbClockAlice = await pify(alice.ebt.clock)({ format: 'bendybutt-v1' })
  t.deepEqual(bbClockAlice, expectedBBClock, 'alice correct bb clock')

  const clockBob = await pify(bob.ebt.clock)({ format: 'classic' })
  t.deepEqual(clockBob, expectedClassicClock, 'bob correct classic clock')

  const bbClockBob = await pify(bob.ebt.clock)({ format: 'bendybutt-v1' })
  t.deepEqual(bbClockBob, expectedBBClock, 'bob correct bb clock')

  await Promise.all([pify(alice.close)(true), pify(bob.close)(true)])
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
    keys: u.keysFor('bob'),
  })

  alice.ebt.registerFormat(bendyButtMethods)
  bob.ebt.registerFormat(bendyButtMethods)

  // self replicate
  alice.ebt.request(alice.id, true)
  alice.ebt.request(aliceMFId, true)
  bob.ebt.request(bob.id, true)
  bob.ebt.request(bobMFId, true)

  const expectedClassicClock = {
    [alice.id]: 1,
    [bob.id]: 1,
  }
  const expectedBBClock = {
    [aliceMFId]: 1,
    [bobMFId]: 1,
  }

  const clockAlice = await pify(alice.ebt.clock)({ format: 'classic' })
  t.deepEqual(clockAlice, expectedClassicClock, 'alice correct classic clock')

  const bbClockAlice = await pify(alice.ebt.clock)({ format: 'bendybutt-v1' })
  t.deepEqual(bbClockAlice, expectedBBClock, 'alice correct bb clock')

  const clockBob = await pify(bob.ebt.clock)({ format: 'classic' })
  t.deepEqual(clockBob, expectedClassicClock, 'bob correct classic clock')

  const bbClockBob = await pify(bob.ebt.clock)({ format: 'bendybutt-v1' })
  t.deepEqual(bbClockBob, expectedBBClock, 'bob correct bb clock')

  await Promise.all([pify(alice.close)(true), pify(bob.close)(true)])
  t.end()
})

const carolDir = getFreshDir('carol')

tape('index format', async (t) => {
  const carol = createSSBServer().call(null, {
    path: carolDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('carol'),
  })

  const daveDir = getFreshDir('dave')
  const dave = createSSBServer().call(null, {
    path: daveDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('dave'),
  })

  const indexedMethods = require('../formats/indexed.js')

  carol.ebt.registerFormat(indexedMethods)
  carol.ebt.registerFormat(bendyButtMethods)
  dave.ebt.registerFormat(indexedMethods)
  dave.ebt.registerFormat(bendyButtMethods)

  const carolIndexId = (
    await pify(carol.indexFeeds.start)({
      author: carol.id,
      type: 'dog',
      private: false,
    })
  ).subfeed
  const daveIndexId = (
    await pify(dave.indexFeeds.start)({
      author: dave.id,
      type: 'dog',
      private: false,
    })
  ).subfeed

  // publish some messages
  await Promise.all([
    pify(carol.db.publish)({ type: 'post', text: 'hello 2' }),
    pify(carol.db.publish)({ type: 'dog', name: 'Buff' }),
    pify(dave.db.publish)({ type: 'post', text: 'hello 2' }),
    pify(dave.db.publish)({ type: 'dog', name: 'Biff' }),
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
  carol.ebt.request(carolIndexId, true, 'indexed-v1')

  dave.ebt.request(dave.id, true)
  dave.ebt.request(daveMetaId, true)
  dave.ebt.request(daveMetaIndexId, true)
  dave.ebt.request(daveIndexId, true, 'indexed-v1')

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

  carol.ebt.request(daveIndexId, true, 'indexed-v1')
  dave.ebt.request(carolIndexId, true, 'indexed-v1')

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
    [daveIndexId]: 1,
  }

  const indexClockCarol = await pify(carol.ebt.clock)({ format: 'indexed-v1' })
  t.deepEqual(indexClockCarol, expectedIndexClock, 'carol correct index clock')

  const indexClockDave = await pify(dave.ebt.clock)({ format: 'indexed-v1' })
  t.deepEqual(indexClockDave, expectedIndexClock, 'dave correct index clock')

  await pify(carol.db.publish)({ type: 'dog', text: 'woof woof' })

  await sleep(2 * REPLICATION_TIMEOUT)
  t.pass('wait for replication to complete')

  const daveCarolMessages2 = await dave.db.query(
    where(author(carol.id)),
    toPromise()
  )
  t.equal(daveCarolMessages2.length, 2, 'dave got 2 dog messages from carol')

  await Promise.all([pify(carol.close)(true), pify(dave.close)(true)])
  t.end()
})

tape('sliced replication', async (t) => {
  alice = createSSBServer().call(null, {
    path: aliceDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('alice'),
  })

  const carol = createSSBServer().call(null, {
    path: carolDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('carol'),
  })

  await Promise.all([
    pify(alice.db.publish)({ type: 'post', text: 'hello2' }),
    pify(alice.db.publish)({ type: 'post', text: 'hello3' }),
  ])

  // carol wants to slice replicate some things, so she overwrites
  // classic for this purpose

  const sliced = [alice.id]

  const slicedMethods = {
    ...require('../formats/classic'),
    appendMsg(sbot, msgVal, cb) {
      let append = sbot.add
      if (sliced.includes(msgVal.author)) {
        append = sbot.db.addOOO
      }

      append(msgVal, (err, msg) => {
        if (err) return cb(err)
        else cb(null, msg)
      })
    },
  }

  carol.ebt.registerFormat(slicedMethods)

  const bobId = u.keysFor('bob').id

  // self replicate
  alice.ebt.request(alice.id, true)
  alice.ebt.request(bob.id, true)
  carol.ebt.request(carol.id, true)

  await pify(carol.connect)(alice.getAddress())

  const clockAlice = await pify(alice.ebt.clock)({ format: 'classic' })
  t.equal(clockAlice[alice.id], 3, 'alice correct index clock')

  carol.ebt.setClockForSlicedReplication(alice.id, clockAlice[alice.id] - 2)
  carol.ebt.request(alice.id, true)

  carol.ebt.request(bobId, true) // in full

  await sleep(2 * REPLICATION_TIMEOUT)
  t.pass('wait for replication to complete')

  const carolAMessages = await carol.db.query(
    where(author(alice.id)),
    toPromise()
  )
  t.equal(carolAMessages.length, 2, 'latest 2 messages from alice')

  const carolBMessages = await carol.db.query(
    where(author(bob.id)),
    toPromise()
  )
  t.equal(carolBMessages.length, 1, 'all messages from bob')

  await Promise.all([pify(alice.close)(true), pify(carol.close)(true)])
  t.end()
})
