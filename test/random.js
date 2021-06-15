const tape = require('tape')
const pull = require('pull-stream')
const paramap = require('pull-paramap')
const crypto = require('crypto')
const ssbKeys = require('ssb-keys')
const SecretStack = require('secret-stack')
const cats = require('cat-names')
const dogs = require('dog-names')
const pify = require('promisify-4loc')
const sleep = require('util').promisify(setTimeout)
const u = require('./misc/util')

const createSsbServer = SecretStack({
  caps: { shs: crypto.randomBytes(32).toString('base64') }
})
  .use(require('ssb-db'))
  .use(require('ssb-replicate'))
  .use(require('ssb-friends'))
  .use(require('..'))
  .use(require('ssb-gossip'))

const AMOUNT_FEEDS = 100
const AMOUNT_MSGS = 10000

const CONNECTION_TIMEOUT = 500 // ms
const REPLICATION_TIMEOUT = 2 * CONNECTION_TIMEOUT

function generateAnimals (bot, mainFeed, amountFeeds, amountMsgs, doneCB) {
  const feeds = [mainFeed]
  while (amountFeeds-- > 0) {
    feeds.push(bot.createFeed())
  }

  u.log('generate NAMES')

  pull(
    pull.values(feeds),
    paramap((feed, cb) => {
      const animal = Math.random() > 0.5 ? 'cat' : 'dog'
      const name = animal === 'cat' ? cats.random() : dogs.allRandom()
      feed.name = name
      u.log(feed.id + ' follows itself')
      feed.add(u.follow(feed.id), cb)
    }, 10),
    pull.drain(null, function (err) {
      if (err) return doneCB(err)

      const posts = []
      pull(
        pull.count(amountMsgs),
        paramap((i, cb) => {
          const feed = u.randary(feeds)
          const r = Math.random()
          // log only 1 in 10, less noise
          if (r < 0.1) u.log(i, feed.id, r)
          // 50% of messages are a random follow
          if (r < 0.5) {
            const otherFeed = u.randary(feeds)
            feed.add(u.follow(otherFeed.id), cb)
          } else if (r < 0.6) {
            feed.add({
              type: 'post',
              text: feed.animal === 'dog' ? 'woof' : 'meow'
            }, function (err, msg) {
              if (err) return cb(err)
              posts.push(msg.key)
              if (posts.length > 100) { posts.shift() }
              cb(null, msg)
            })
          } else {
            const post = u.randary(posts)
            feed.add({
              type: 'post',
              repliesTo: post,
              text: feed.animal === 'dog' ? 'woof woof' : 'purr'
            }, cb)
          }
        }, 32),
        pull.drain(null, doneCB)
      )
    })
  )
}

const alice = createSsbServer({
  temp: 'ebt_test-random-animals',
  timeout: CONNECTION_TIMEOUT,
  replicate: { hops: 3, legacy: false },
  keys: ssbKeys.generate(),
})

let liveMsgCount = 0
alice.post(function () {
  if (!(liveMsgCount++ % 100)) {
    u.log('liveMsgCount', liveMsgCount)
  }
})

pull(
  alice.replicate.changes(),
  pull.drain(function (prog) {
    prog.id = 'animal network'
    u.log('replicate.changes', prog)
  })
)

tape('generate random network', async (t) => {
  t.plan(3)
  const start = Date.now()

  await pify(generateAnimals)(alice, { add: alice.publish, id: alice.id }, AMOUNT_FEEDS, AMOUNT_MSGS)

  u.log('replicate GRAPH')

  const generated = await pify(alice.getVectorClock)()

  let total = 0
  let feeds = 0
  for (const k in generated) {
    total += generated[k]
    feeds++
  }

  const duration = (Date.now() - start) / 1000
  const rate = (total / duration).toFixed(1)

  t.pass(`generated ${total} msgs over ${feeds} feeds in ${duration.toFixed(1)}s (rate: ${rate} msgs/s)`)
  t.equal(total, AMOUNT_MSGS + 1 + AMOUNT_FEEDS + 1, 'expected amount of msgs')
  t.equal(feeds, AMOUNT_FEEDS + 1, 'expected amount of feeds')
  t.end()
})

tape('read all history streams', function (t) {
  t.plan(5)
  let msgs = 0
  const start = Date.now()

  // test just dumping everything!
  // not through network connection, because createLogStream is not on public api
  pull(
    alice.createLogStream({ keys: false }),
    pull.drain(function (n) {
      msgs++
    }, function () {
      const duration = (Date.now() - start) / 1000
      const rate = (msgs / duration).toFixed(1)
      t.pass('dump all messages via createLogStream')
      t.pass(`all histories dumped ${msgs} msgs in ${duration.toFixed(1)}s (rate ${rate} msgs/s)`)
      t.pass(`live msg count: ${liveMsgCount}`)
      t.equal(msgs, AMOUNT_FEEDS + AMOUNT_MSGS + 2, 'expected amount of msgs')
      t.equal(liveMsgCount, AMOUNT_FEEDS + AMOUNT_MSGS + 2, 'expected live amount of msgs')
      t.end()
    })
  )
})

tape('replicate social network for animals', async (t) => {
  t.plan(3)
  if (!alice.friends) { throw new Error('missing friends plugin') }

  const start = Date.now()
  const bob = createSsbServer({
    temp: 'ebt_test-random-animals2',
    timeout: CONNECTION_TIMEOUT,
    replicate: { hops: 3, legacy: false },
    keys: ssbKeys.generate()
  })

  if (!bob.friends) { throw new Error('missing friends plugin') }

  await pify(bob.connect)(alice.getAddress())

  await pify(bob.publish)({
    type: 'contact',
    contact: alice.id,
    following: true
  })

  await sleep(REPLICATION_TIMEOUT)

  const prog = bob.progress()
  t.ok(prog.ebt, 'bob ebt is okay')
  t.equals(prog.ebt.current, prog.ebt.target, 'bob ebt is done')

  const target = AMOUNT_FEEDS + AMOUNT_MSGS + 3
  const time = (Date.now() - start) / 1000
  const rate = (target / time).toFixed(1)
  t.pass(`replicated ${target} msgs in ${time}s (rate ${rate} msgs/s)`)
  await pify(bob.close)(true)

  t.end()
})

tape('teardown', async (t) => {
  await pify(alice.close)(true)
  t.end()
})
