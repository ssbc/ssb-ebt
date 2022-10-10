const tape = require('tape')
const SecretStack = require('secret-stack')
const pify = require('promisify-4loc')
const pull = require('pull-stream')
const caps = require('ssb-caps')
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const {
  where,
  type,
  live,
  count,
  toPromise,
  toPullStream,
} = require('ssb-db2/operators')
const u = require('./misc/util')

const bendyButtMethods = require('../formats/bendy-butt')
const indexedMethods = require('../formats/indexed.js')

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

function getFreshDir(name) {
  const dir = '/tmp/test-format-' + name + Date.now()
  rimraf.sync(dir)
  mkdirp.sync(dir)
  return dir
}

const aliceDir = getFreshDir('alice')
let alice

const bobDir = getFreshDir('bob')
let bob

tape('switching from full replication to indexed-v1 replication', async (t) => {
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
  alice.ebt.registerFormat(indexedMethods)
  bob.ebt.registerFormat(bendyButtMethods)
  bob.ebt.registerFormat(indexedMethods)

  await pify(alice.db.create)({ content: { type: 'post', text: '1st post' } })
  await pify(alice.db.create)({ content: { type: 'post', text: '2nd post' } })
  await pify(alice.db.create)({ content: { type: 'post', text: '3rd post' } })
  t.pass('alice created 3 posts')

  alice.ebt.request(alice.id, true)
  bob.ebt.request(bob.id, true)
  t.pass('alice and bob are requesting their own feeds')

  alice.ebt.request(bob.id, true)
  bob.ebt.request(alice.id, true)
  t.pass('alice and bob are requesting each others feeds')

  await pify(bob.connect)(alice.getAddress())
  t.pass('bob connected to alice')

  await new Promise((resolve, reject) => {
    pull(
      bob.db.query(where(type('post')), live({ old: true }), toPullStream()),
      pull.drain(
        (msg) => {
          if (msg.value.content.text === '3rd post') {
            resolve()
            return false // abort the drain
          }
        },
        (err) => {
          if (err) reject(err)
        }
      )
    )
  })
  t.pass('bob replicated alice main')

  const clockAlice = await pify(alice.ebt.clock)({ format: 'classic' })
  t.deepEqual(
    clockAlice,
    {
      [alice.id]: 3,
    },
    'alice has correct classic clock'
  )

  const clockBob = await pify(bob.ebt.clock)({ format: 'classic' })
  t.deepEqual(
    clockBob,
    {
      [alice.id]: 3,
    },
    'bob has correct classic clock'
  )

  await pify(alice.indexFeeds.start)({
    author: alice.id,
    type: 'post',
    private: false,
  })
  t.pass('alice started indexing posts')

  await new Promise((resolve, reject) => {
    pull(
      alice.db.query(
        where(type('metafeed/index')),
        live({ old: true }),
        toPullStream()
      ),
      pull.take(3),
      pull.collect((err) => {
        if (err) reject(err)
        else resolve()
      })
    )
  })
  t.pass('alice has written her index feed')

  const branches = await new Promise((resolve, reject) => {
    pull(
      alice.metafeeds.branchStream({ live: false, old: true }),
      pull.collect((err, branches) => {
        if (err) reject(err)
        else resolve(branches)
      })
    )
  })
  const indexBranch = branches.find(
    (branch) =>
      branch.length === 4 && // root + v1 + shard + index
      branch[0][1].feedpurpose === 'root' &&
      branch[1][1].feedpurpose === 'v1' &&
      branch[2][1].feedformat === 'bendybutt-v1' &&
      branch[3][1].feedpurpose === 'index'
  )
  t.ok(indexBranch, 'alice has an index branch on the metafeed tree')
  const aliceRootId = indexBranch[0][0]
  const aliceV1Id = indexBranch[1][0]
  const aliceShardId = indexBranch[2][0]
  const aliceIndexId = indexBranch[3][0]

  alice.ebt.request(aliceRootId, true)
  alice.ebt.request(aliceV1Id, true)
  alice.ebt.request(aliceShardId, true)
  alice.ebt.request(aliceIndexId, true)
  t.pass('alice started requesting her metafeed tree')

  bob.ebt.request(alice.id, false)
  t.pass('bob stopped requesting alice main')
  bob.ebt.request(aliceRootId, true)
  bob.ebt.request(aliceV1Id, true)
  bob.ebt.request(aliceShardId, true)
  bob.ebt.request(aliceIndexId, true)
  t.pass('bob started requesting alice metafeed tree')

  await new Promise((resolve, reject) => {
    pull(
      bob.db.query(
        where(type('metafeed/index')),
        live({ old: true }),
        toPullStream()
      ),
      pull.take(3),
      pull.collect((err) => {
        if (err) reject(err)
        else resolve()
      })
    )
  })
  t.pass('bob replicated alice index feed')

  const bobCount = await bob.db.query(where(type('post')), count(), toPromise())
  t.equal(bobCount, 3, 'bob still has only the same posts from alice')

  const clockAliceBB = await pify(alice.ebt.clock)({ format: 'bendybutt-v1' })
  t.deepEqual(
    clockAliceBB,
    {
      [aliceRootId]: 2, // v1 + main
      [aliceV1Id]: 1, // shard
      [aliceShardId]: 1, // index
    },
    'alice has correct bendybutt-v1 clock'
  )

  const clockAliceI = await pify(alice.ebt.clock)({ format: 'indexed-v1' })
  t.deepEqual(
    clockAliceI,
    {
      [aliceIndexId]: 3,
    },
    'alice has correct indexed-v1 clock'
  )

  const clockBobBB = await pify(bob.ebt.clock)({ format: 'bendybutt-v1' })
  t.deepEqual(
    clockBobBB,
    {
      [aliceRootId]: 2, // v1 + main
      [aliceV1Id]: 1, // shard
      [aliceShardId]: 1, // index
    },
    'bob has correct bendybutt-v1 clock'
  )

  const clockBobI = await pify(bob.ebt.clock)({ format: 'indexed-v1' })
  t.deepEqual(
    clockBobI,
    {
      [aliceIndexId]: 3,
    },
    'bob has correct indexed-v1 clock'
  )

  await Promise.all([pify(alice.close)(true), pify(bob.close)(true)])
  t.end()
})
