// to run this you need to disable debouncer in db2

const tape = require('tape')
const SecretStack = require('secret-stack')
const sleep = require('util').promisify(setTimeout)
const pify = require('promisify-4loc')
const u = require('../test/misc/util')

const caps = require('ssb-caps')
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const ssbKeys = require('ssb-keys')
const butt2 = require('ssb-buttwoo/format')
const classic = require('ssb-classic/format')
const { toPromise } = require('ssb-db2/operators')

function createSSBServer() {
  return SecretStack({ appKey: caps.shs })
    .use(require('ssb-db2'))
    .use(require('ssb-buttwoo'))
    .use(require('ssb-bendy-butt'))
    .use(require('ssb-db2/compat/ebt'))
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
let alice = createSSBServer().call(null, {
  path: aliceDir,
  timeout: CONNECTION_TIMEOUT,
  keys: u.keysFor('alice'),
})

const bobDir = getFreshDir('bob')
let bob = createSSBServer().call(null, {
  path: bobDir,
  timeout: CONNECTION_TIMEOUT,
  keys: u.keysFor('bob'),
})

const butt2Methods = require('../formats/buttwoo')

const content = {
  type: 'post',
  channel: 'tinyssb',
  text: '# Introducing ScuttleSort: incremental untangling\n\nThese past days (weeks..) I worked on something wonderful and would like to have your advise and scrutiny.\n\nIt\'s about creating total order (a timeline) from tangled feeds _without_ indexing: instead, when a new log entry arrives, I now have a method to compute its position in the total order "on the fly" (aka incremental). It\'s a total order with "strong eventual consistency" that is, regardless in which order you or me ingest log entries, we both will end up with the same timeline. It also hooks directly into a MVC environment i.e. log entries automagically show up at the right place.\n\nIt\'s lengthy writeup [README.pdf](&pyKqGIPMMtUMTzhZxt1f/jNmU9lal+0ogvqbmEYLNJI=.sha256) how I arrived there, and there is also code:\n```\n% python3 -m pip install scuttlesort\n% npm install scuttlesort\n```\n(it\'s my third or so JavaScript program, so bare with me 8-), any suggestion for improvements more than welcome)\n\nBoth versions come with a demo program which shows the convergence by exhaustively trying out all possible delivery schedules for a small tangle.\n\nIs something similar already used somewhere in the SSB code base? If novel, is anybody interested to go for a academic paper?\n\nHere is a first abstract, subject to your improvements:\n\n> _ScuttleSort: Incremental and Convergent Linearization of Tangles_\n>\n> We present an incremental topological sort algorithm that permits to linearize tangled append-only feeds in a convergent way with modest effort. Moreover, our architecture permits to synchronize the linearization with a local replica (database, GUI) such that on average one to three edit operations per log entry are sufficient, for reasonably sized tangles. We discuss the use and performance of “ScuttleSort” for append-only systems like Secure Scuttlebutt (SSB). In terms of conflict-free replicated data types (CRDT), our update algorithm implements a partial order-preserving replicated add-only sequence (“timeline”) with strong eventual consistency.\n',
  mentions: [
    {
      link: '&pyKqGIPMMtUMTzhZxt1f/jNmU9lal+0ogvqbmEYLNJI=.sha256',
      name: 'README.pdf',
      type: 'application/pdf',
      size: 827090,
    },
  ],
}
const simpleContent = { text: 'hello world', type: 'post' }

tape('butt2 performance', async (t) => {
  // falsify to test butt2
  if (true) { t.end(); return }

  alice.ebt.registerFormat(butt2Methods)
  bob.ebt.registerFormat(butt2Methods)

  // self replicate
  alice.ebt.request(alice.id, true)
  bob.ebt.request(bob.id, true)

  let messagesAtBob = 0
  bob.db.onMsgAdded((msg) => {
    messagesAtBob += 1
  })

  let messages = []
  const aliceButtKeys = ssbKeys.generate(null, 'alice', 'buttwoo-v1')
  const hmacKey = null
  let previous = { key: null, value: { sequence: 0 } }
  let startDate = +new Date()
  for (var i = 0; i < 15 * 1000; ++i) {
    const butt2Msg = butt2.newNativeMsg({
      keys: aliceButtKeys,
      content,
      previous,
      timestamp: startDate++,
      tag: butt2.tags.SSB_FEED,
      hmacKey
    })
    previous = {
      key: butt2.getMsgId(butt2Msg),
      value: butt2.fromNativeMsg(butt2Msg)
    }
    messages.push(butt2Msg)
  }

  console.time("adding 15k msgs")
  const publishes = []
  for (var i = 0; i < 15 * 1000; ++i)
    publishes.push(pify(alice.db.add)(messages[i], { encoding: 'bipf', feedFormat: 'buttwoo-v1' }))

  await Promise.all(publishes)
  console.timeEnd("adding 15k msgs")

  // let alice have some time to index stuff
  await sleep(5 * REPLICATION_TIMEOUT)
  const results = await alice.db.query(toPromise())
  console.log("alice has", results.length)

  const aliceButtId = aliceButtKeys.id

  // self replicate
  alice.ebt.request(aliceButtId, true)

  alice.ebt.request(bob.id, true)
  bob.ebt.request(alice.id, true)
  bob.ebt.request(aliceButtId, true)

  await pify(bob.connect)(alice.getAddress())

  await sleep(3 * REPLICATION_TIMEOUT)
  t.pass('wait for replication to complete')

  console.log('after', 3 * REPLICATION_TIMEOUT, 'ms bob has', messagesAtBob)

  t.end()
})

tape('classic performance', async (t) => {
  // self replicate
  alice.ebt.request(alice.id, true)
  bob.ebt.request(bob.id, true)

  let messagesAtBob = 0
  bob.db.onMsgAdded((msg) => {
    messagesAtBob += 1
  })

  let messages = []
  const aliceKeys = u.keysFor('alice')
  let previous = { key: null, value: { sequence: 0 } }
  let startDate = +new Date()
  for (var i = 0; i < 15 * 1000; ++i) {
    const msgVal = classic.newNativeMsg({
      keys: aliceKeys,
      content, //: simpleContent
      timestamp: startDate++,
      previous,
      hmacKey: null,
    })
    previous = {
      key: classic.getMsgId(msgVal),
      value: msgVal
    }
    messages.push(JSON.stringify(msgVal))
  }

  console.time("adding 15k msgs")
  const publishes = []
  for (var i = 0; i < 15 * 1000; ++i) {
    const msg = JSON.parse(messages[i])
    publishes.push(pify(alice.db.add)(msg, { encoding: 'js', feedFormat: 'classic' }))
  }

  await Promise.all(publishes)
  console.timeEnd("adding 15k msgs")

  // let alice have some time to index stuff
  await sleep(5 * REPLICATION_TIMEOUT)
  const results = await alice.db.query(toPromise())

  alice.ebt.request(bob.id, true)

  bob.ebt.request(alice.id, true)

  await pify(bob.connect)(alice.getAddress())

  await sleep(3 * REPLICATION_TIMEOUT)
  t.pass('wait for replication to complete')

  console.log('after', 3 * REPLICATION_TIMEOUT, 'ms bob has', messagesAtBob)

  t.end()
})
