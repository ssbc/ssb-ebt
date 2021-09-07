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
  ebt: {
    logging: false
  }
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
  // used in getAt
  fromDB(msg) {
    return msg ? bendyButt.encode(msg.value) : null
  },
  // used in append
  toDB(msgVal) {
    return bendyButt.decode(msgVal)
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
    ebt: {
      logging: false
    }
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
