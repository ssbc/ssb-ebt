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
const { where, author, toPromise } = require('ssb-db2/operators')

function createSsbServer() {
  return SecretStack({ appKey: caps.shs })
    .use(require('ssb-db2'))
    .use(require('ssb-db2/compat/ebt'))
    .use(require('../'))
}

const CONNECTION_TIMEOUT = 500 // ms
const REPLICATION_TIMEOUT = 2 * CONNECTION_TIMEOUT

const aliceDir = '/tmp/test-format-alice'
rimraf.sync(aliceDir)
mkdirp.sync(aliceDir)

let alice = createSsbServer().call(null, {
  path: aliceDir,
  timeout: CONNECTION_TIMEOUT,
  keys: u.keysFor('alice'),
})

const bobDir = '/tmp/test-format-bob'
rimraf.sync(bobDir)
mkdirp.sync(bobDir)

let bob = createSsbServer().call(null, {
  path: bobDir,
  timeout: CONNECTION_TIMEOUT,
  keys: u.keysFor('bob')
})

const bendyButtMethods = {
  // used in request, block, cleanClock, sbot.post
  isFeed: SSBURI.isBendyButtV1FeedSSBURI,
  getAtSequence(sbot, pair, cb) {
    sbot.getAtSequence([pair.id, pair.sequence], (err, msg) => {
      cb(err, msg ? bendyButt.encode(msg.value) : null)
    })
  },
  appendMsg(sbot, msgVal, cb) {
    sbot.add(bendyButt.decode(msgVal), (err, msg) => {
      cb(err && err.fatal ? err : null, msg)
    })
  },

  // used in ebt:stream to distinguish between messages and notes
  isMsg(bbVal) {
    if (!Buffer.isBuffer(bbVal)) return false

    const msgVal = bendyButt.decode(bbVal)
    return msgVal &&
      Number.isInteger(msgVal.sequence) && msgVal.sequence > 0 &&
      typeof msgVal.author == 'string' && msgVal.content
  },
  // used in ebt:events
  getMsgAuthor(bbVal) {
    //console.log("bb getMsgAuthor", Buffer.isBuffer(bbVal))
    if (Buffer.isBuffer(bbVal))
      return bendyButt.decode(bbVal).author
    else
      return bbVal.author
  },
  // used in ebt:events
  getMsgSequence(bbVal) {
    //console.log("bb getMsgSequence", Buffer.isBuffer(bbVal))
    if (Buffer.isBuffer(bbVal))
      return bendyButt.decode(bbVal).sequence
    else
      return bbVal.sequence
  }
}

function getBBMsg(mainKeys) {
  // fake some keys
  const mfKeys = ssbKeys.generate()
  const classicUri = SSBURI.fromFeedSigil(mfKeys.id)
  const { type, /* format, */ data } = SSBURI.decompose(classicUri)
  const bendybuttUri = SSBURI.compose({ type, format: 'bendybutt-v1', data })
  mfKeys.id = bendybuttUri

  const content = {
    type: "metafeed/add",
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

// need them later
let aliceMFId
let bobMFId

tape('multiple formats', async (t) => {
  alice.ebt.registerFormat('bendybutt', bendyButtMethods)
  bob.ebt.registerFormat('bendybutt', bendyButtMethods)

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
  alice.ebt.request(aliceMFId, true, 'bendybutt')
  bob.ebt.request(bobMFId, true, 'bendybutt')

  await Promise.all([
    pify(alice.add)(aliceBBMsg),
    pify(bob.add)(bobBBMsg)
  ])

  alice.ebt.request(bob.id, true)
  alice.ebt.request(bobMFId, true, 'bendybutt')

  bob.ebt.request(alice.id, true)
  bob.ebt.request(aliceMFId, true, 'bendybutt')

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

  const clockAlice = await pify(alice.ebt.clock)('classic')
  t.deepEqual(clockAlice, expectedClassicClock, 'alice correct classic clock')

  const bbClockAlice = await pify(alice.ebt.clock)('bendybutt')
  t.deepEqual(bbClockAlice, expectedBBClock, 'alice correct bb clock')

  const clockBob = await pify(bob.ebt.clock)('classic')
  t.deepEqual(clockBob, expectedClassicClock, 'bob correct classic clock')

  const bbClockBob = await pify(bob.ebt.clock)('bendybutt')
  t.deepEqual(bbClockBob, expectedBBClock, 'bob correct bb clock')

  await Promise.all([
    pify(alice.close)(true),
    pify(bob.close)(true)
  ])
  t.end()
})

tape('multiple formats restart', async (t) => {
  alice = createSsbServer().call(null, {
    path: aliceDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('alice'),
  })

  bob = createSsbServer().call(null, {
    path: bobDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('bob')
  })

  alice.ebt.registerFormat('bendybutt', bendyButtMethods)
  bob.ebt.registerFormat('bendybutt', bendyButtMethods)

  // self replicate
  alice.ebt.request(alice.id, true)
  alice.ebt.request(aliceMFId, true, 'bendybutt')
  bob.ebt.request(bob.id, true)
  bob.ebt.request(bobMFId, true, 'bendybutt')

  const expectedClassicClock = {
    [alice.id]: 1,
    [bob.id]: 1
  }
  const expectedBBClock = {
    [aliceMFId]: 1,
    [bobMFId]: 1
  }

  const clockAlice = await pify(alice.ebt.clock)('classic')
  t.deepEqual(clockAlice, expectedClassicClock, 'alice correct classic clock')

  const bbClockAlice = await pify(alice.ebt.clock)('bendybutt')
  t.deepEqual(bbClockAlice, expectedBBClock, 'alice correct bb clock')

  const clockBob = await pify(bob.ebt.clock)('classic')
  t.deepEqual(clockBob, expectedClassicClock, 'bob correct classic clock')

  const bbClockBob = await pify(bob.ebt.clock)('bendybutt')
  t.deepEqual(bbClockBob, expectedBBClock, 'bob correct bb clock')

  await Promise.all([
    pify(alice.close)(true),
    pify(bob.close)(true)
  ])
  t.end()
})

let indexedFeeds = []

// first solution:
// replicating index feeds using classic and indexed using a special
// format does not work because ebt:events expects messages to come in
// order. Furthermore getting the vector clock of this indexed ebt on
// start is also a bit complicated

// second solution:
// - don't send indexes over classic unless you only replicate the index
// - use a special indexed format that sends both index + indexed as 1
//   message with indexed as payload
// - this requires that we are able to add 2 messages in a
//   transaction. Should be doable, but requires changes all the way
//   down the stack

const indexedFeedMethods = Object.assign(
  {}, alice.ebt.formats['classic'], {
    isFeed(author) {
      return indexedFeeds.includes(author)
    },
    appendMsg(sbot, msgVal, cb) {
      const payload = msgVal.content.indexed.payload
      delete msgVal.content.indexed.payload
      sbot.db.add(msgVal, (err, msg) => {
        if (err) return cb(err)
        sbot.db.addOOO(payload, (err, indexedMsg) => {
          if (err) return cb(err)
          else cb(null, msg)
        })
      })
    },
    getAtSequence(sbot, pair, cb) {
      sbot.getAtSequence([pair.id, pair.sequence], (err, msg) => {
        if (err) return cb(err)
        const { author, sequence } = msg.value.content.indexed
        sbot.getAtSequence([author, sequence], (err, indexedMsg) => {
          if (err) return cb(err)

          // add referenced message as payload
          msg.value.content.indexed.payload = indexedMsg.value

          cb(null, msg.value)
        })
      })
    }
  }
)

const aliceIndexKey = ssbKeys.generate()

tape('index format', async (t) => {
  const bobIndexKey = ssbKeys.generate()

  indexedFeeds.push(aliceIndexKey.id)
  indexedFeeds.push(bobIndexKey.id)

  alice = createSsbServer().call(null, {
    path: aliceDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('alice')
  })

  bob = createSsbServer().call(null, {
    path: bobDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('bob')
  })

  alice.ebt.registerFormat('indexedfeed', indexedFeedMethods)
  bob.ebt.registerFormat('indexedfeed', indexedFeedMethods)

  // publish a few more messages
  const res = await Promise.all([
    pify(alice.db.publish)({ type: 'post', text: 'hello 2' }),
    pify(alice.db.publish)({ type: 'dog', name: 'Buff' }),
    pify(bob.db.publish)({ type: 'post', text: 'hello 2' }),
    pify(bob.db.publish)({ type: 'dog', name: 'Biff' })
  ])

  // index the dog messages
  await Promise.all([
    pify(alice.db.publishAs)(aliceIndexKey, {
      type: 'metafeed/index',
      indexed: {
        key: res[1].key,
        author: alice.id,
        sequence: res[1].value.sequence
      }
    }),
    pify(bob.db.publishAs)(bobIndexKey, {
      type: 'metafeed/index',
      indexed: {
        key: res[3].key,
        author: bob.id,
        sequence: res[3].value.sequence
      }
    })
  ])

  // self replicate
  alice.ebt.request(alice.id, true)
  alice.ebt.request(aliceIndexKey.id, true, 'indexedfeed')
  bob.ebt.request(bob.id, true)
  bob.ebt.request(bobIndexKey.id, true, 'indexedfeed')

  // only replicate index feeds
  alice.ebt.request(bobIndexKey.id, true, 'indexedfeed')
  bob.ebt.request(aliceIndexKey.id, true, 'indexedfeed')

  await pify(bob.connect)(alice.getAddress())

  await sleep(2 * REPLICATION_TIMEOUT)
  t.pass('wait for replication to complete')

  // we should only get the dog message and not second post
  const aliceBobMessages = await alice.db.query(
    where(author(bob.id)),
    toPromise()
  )
  t.equal(aliceBobMessages.length, 2, 'alice correct messages from bob')

  const bobAliceMessages = await bob.db.query(
    where(author(alice.id)),
    toPromise()
  )
  t.equal(bobAliceMessages.length, 2, 'bob correct messages from alice')

  const expectedIndexClock = {
    [aliceIndexKey.id]: 1,
    [bobIndexKey.id]: 1
  }

  const indexClockAlice = await pify(alice.ebt.clock)('indexedfeed')
  t.deepEqual(indexClockAlice, expectedIndexClock, 'alice correct index clock')

  const indexClockBob = await pify(bob.ebt.clock)('indexedfeed')
  t.deepEqual(indexClockBob, expectedIndexClock, 'bob correct index clock')

  await Promise.all([
    pify(alice.close)(true),
    pify(bob.close)(true)
  ])
  t.end()
})

const sliceIndexedFeedMethods = Object.assign(
  {}, alice.ebt.formats['classic'], {
    isFeed(author) {
      return indexedFeeds.includes(author)
    },
    appendMsg(sbot, msgVal, cb) {
      const payload = msgVal.content.indexed.payload
      delete msgVal.content.indexed.payload
      sbot.db.addOOO(msgVal, (err, msg) => {
        if (err) return cb(err)
        sbot.db.addOOO(payload, (err, indexedMsg) => {
          if (err) return cb(err)
          else cb(null, msg)
        })
      })
    },
    getAtSequence(sbot, pair, cb) {
      sbot.getAtSequence([pair.id, pair.sequence], (err, msg) => {
        if (err) return cb(err)
        const { author, sequence } = msg.value.content.indexed
        sbot.getAtSequence([author, sequence], (err, indexedMsg) => {
          if (err) return cb(err)

          // add referenced message as payload
          msg.value.content.indexed.payload = indexedMsg.value

          cb(null, msg.value)
        })
      })
    }
  }
)

tape('sliced index replication', async (t) => {
  alice = createSsbServer().call(null, {
    path: aliceDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('alice')
  })

  const carolDir = '/tmp/test-format-carol'
  rimraf.sync(carolDir)
  mkdirp.sync(carolDir)

  let carol = createSsbServer().call(null, {
    path: carolDir,
    timeout: CONNECTION_TIMEOUT,
    keys: u.keysFor('carol')
  })

  alice.ebt.registerFormat('indexedfeed', sliceIndexedFeedMethods)
  carol.ebt.registerFormat('indexedfeed', sliceIndexedFeedMethods)

  // self replicate
  alice.ebt.request(alice.id, true)
  alice.ebt.request(aliceIndexKey.id, true, 'indexedfeed')
  carol.ebt.request(carol.id, true)

  // publish a few more messages
  const res = await pify(alice.db.publish)({ type: 'dog', name: 'Buffy' })

  // index the new dog message
  await pify(alice.db.publishAs)(aliceIndexKey, {
      type: 'metafeed/index',
      indexed: {
        key: res.key,
        author: alice.id,
        sequence: res.value.sequence
      }
  })

  await pify(carol.connect)(alice.getAddress())

  const clockAlice = await pify(alice.ebt.clock)('indexedfeed')
  t.equal(clockAlice[aliceIndexKey.id], 2, 'alice correct index clock')

  carol.ebt.setClockForSlicedReplication('indexedfeed', aliceIndexKey.id,
                                         clockAlice[aliceIndexKey.id] - 1)
  carol.ebt.request(aliceIndexKey.id, true, 'indexedfeed')

  await sleep(2 * REPLICATION_TIMEOUT)
  t.pass('wait for replication to complete')

  const carolMessages = await carol.db.query(toPromise())
  t.equal(carolMessages.length, 2, '1 index + 1 indexed message')

  await Promise.all([
    pify(alice.close)(true),
    pify(carol.close)(true)
  ])
  t.end()
})
