const tape = require('tape')
const pull = require('pull-stream')
const paramap = require('pull-paramap')
const crypto = require('crypto')
const ssbKeys = require('ssb-keys')
const SecretStack = require('secret-stack')
const cats = require('cat-names')
const dogs = require('dog-names')
const u = require('./util')

const createSsbServer = SecretStack({
  caps: { shs: crypto.randomBytes(32).toString('base64') }
})
  .use(require('ssb-db'))
  .use(require('ssb-replicate'))
  .use(require('ssb-friends'))
  .use(require('..'))
  .use(require('ssb-gossip'))

let generated = {}
const F = 100
const N = 10000

function generateAnimals (ssbServer, feed, f, n, cb) {
  const a = [feed]

  while (f-- > 0) { a.push(ssbServer.createFeed()) }

  console.log('generate NAMES')

  pull(
    pull.values(a),
    paramap(function (feed, cb) {
      const animal = Math.random() > 0.5 ? 'cat' : 'dog'
      const name = animal === 'cat' ? cats.random() : dogs.allRandom()

      feed.name = name
      console.log(feed.id)
      feed.add(u.follow(feed.id), cb)
    }, 10),
    pull.drain(null, function (err) {
      if (err) return cb(err)
      const posts = []

      pull(
        pull.count(n),
        paramap(function (n, cb) {
          const me = a[~~(Math.random() * a.length)]
          const r = Math.random()
          if (r < 0.1) console.log(n, me.id, r) // log only 1 in 10, less noise
          // one in 20 messages is a random follow
          if (r < 0.5) {
            const f = a[~~(Math.random() * a.length)]
            me.add(u.follow(f.id), cb)
          } else if (r < 0.6) {
            me.add({
              type: 'post',
              text: me.animal === 'dog' ? 'woof' : 'meow'
            }, function (err, msg) {
              if (err) throw err
              posts.push(msg.key)
              if (posts.length > 100) { posts.shift() }
              cb(null, msg)
            })
          } else {
            const post = posts[~~(Math.random() * posts.length)]
            me.add({
              type: 'post',
              repliesTo: post,
              text: me.animal === 'dog' ? 'woof woof' : 'purr'
            }, function (err, msg) {
              if (err) cb(err)
              else cb(null, msg)
            })
          }
        }, 32),
        pull.drain(null, cb)
      )
    })
  )
}

const alice = ssbKeys.generate()
const bob = ssbKeys.generate()

const animalNetwork = createSsbServer({
  temp: 'ebt_test-random-animals',
  port: 45651,
  host: 'localhost',
  timeout: 20001,
  replicate: { hops: 3, legacy: false },
  keys: alice,
  gossip: { pub: false }
})

let live = 0
animalNetwork.post(function () {
  if (!(live++ % 100)) {
    console.log(live, live)
  }
})

pull(
  animalNetwork.replicate.changes(),
  pull.drain(function (prog) {
    prog.id = 'animal network'
    console.log(prog)
  })
)

tape('generate random network', function (t) {
  const start = Date.now()
  generateAnimals(animalNetwork, { add: animalNetwork.publish, id: animalNetwork.id }, F, N, function (err) {
    if (err) throw err
    console.log('replicate GRAPH')
    animalNetwork.getVectorClock(function (err, _generated) {
      if (err) throw err

      generated = _generated
      let total = 0
      let feeds = 0
      for (const k in generated) {
        total += generated[k]
        feeds++
      }

      const time = (Date.now() - start) / 1000
      console.log('generated', total, 'messages in', time, 'at rate:', total / time)
      console.log('over', feeds, 'feeds')
      t.equal(total, N + 1 + F + 1)
      t.equal(feeds, F + 1)
      t.end()
    })
  })
})

tape('read all history streams', function (t) {
  let c = 0
  const start = Date.now()

  // test just dumping everything!
  // not through network connection, because createLogStream is not on public api
  pull(
    animalNetwork.createLogStream({ keys: false }),
    pull.drain(function (n) {
      c++
    }, function () {
      const time = (Date.now() - start) / 1000
      console.log('dump all messages via createLogStream')
      console.log('all histories dumped', c, 'messages in', time, 'at rate', c / time)
      console.log('read back live:', live)
      t.equal(live, F + N + 2)
      t.equal(c, F + N + 2)
      t.end()
    })
  )
})

tape('replicate social network for animals', function (t) {
  // return t.end()
  let c = 0
  if (!animalNetwork.friends) { throw new Error('missing frineds plugin') }

  const start = Date.now()
  const animalFriends = createSsbServer({
    temp: 'ebt_test-random-animals2',
    port: 45652,
    host: 'localhost',
    timeout: 20001,
    replicate: { hops: 3, legacy: false },
    gossip: { pub: false },
    progress: true,
    seeds: [animalNetwork.getAddress()],
    keys: bob
  })
  let connections = 0

  animalFriends.on('rpc:connect', function (rpc) {
    connections++
    c++
    console.log('CONNECT', connections)
    rpc.on('closed', function () {
      console.log('DISCONNECT', --connections)
    })
  })

  const int = setInterval(function () {
    const prog = animalFriends.progress()
    if (prog.ebt && prog.ebt.current === prog.ebt.target) {
      const target = F + N + 3
      const time = (Date.now() - start) / 1000
      console.log('replicated', target, 'messages in', time, 'at rate', target / time)
      clearInterval(int)
      t.equal(c, 1, 'everything replicated within a single connection')
      animalFriends.close(true)
      t.end()
    }
  }, 200)

  animalFriends.logging = true

  if (!animalFriends.friends) { throw new Error('missing friends plugin') }

  animalFriends.publish({
    type: 'contact',
    contact: animalNetwork.id,
    following: true
  }, function (err, msg) {
    if (err) throw err
  })
})

tape('shutdown', function (t) {
  animalNetwork.close(true)
  t.end()
})
