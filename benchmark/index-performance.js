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
const classic = require('ssb-classic/format')
const { toPromise } = require('ssb-db2/operators')

function createSSBServer() {
  return SecretStack({ appKey: caps.shs })
    .use(require('ssb-db2'))
    .use(require('ssb-db2/compat/ebt'))
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

const simpleContent = { text: 'hello world', type: 'post' }
const simpleContent2 = { text: 'hello world', type: 'post2' }

tape('index performance', async (t) => {
  const indexedMethods = require('../formats/indexed.js')

  console.log("alice is", alice.id)
  console.log("bob is", bob.id)

  alice.ebt.registerFormat(indexedMethods)
  bob.ebt.registerFormat(indexedMethods)

  // create index feed
  const aliceIndexId = (
    await pify(alice.indexFeeds.start)({
      author: alice.id,
      type: 'post',
      private: false,
    })
  ).subfeed

  console.log("alice index feed", aliceIndexId)

  // self replicate
  alice.ebt.request(alice.id, true)
  alice.ebt.request(aliceIndexId, true)
  bob.ebt.request(bob.id, true)

  const noMessages = 10 * 1000

  const publishes = []
  for (var i = 0; i < noMessages; ++i) {
    publishes.push(pify(alice.db.publish)(
      i % 2 ? simpleContent : simpleContent2
    ))
  }

  await Promise.all(publishes)

  // let alice have some time to index stuff
  await sleep(10 * REPLICATION_TIMEOUT)
  const results = await alice.db.query(toPromise())

  let messagesAtBob = 0
  bob.db.onMsgAdded((msg) => {
    messagesAtBob += 1
  })

  // start replication
  bob.ebt.request(aliceIndexId, true, 'indexed-v1')

  await pify(bob.connect)(alice.getAddress())

  await sleep(3 * REPLICATION_TIMEOUT)
  t.pass('wait for replication to complete')

  console.log('after', 3 * REPLICATION_TIMEOUT, 'ms bob has', messagesAtBob)

  t.end()
})
