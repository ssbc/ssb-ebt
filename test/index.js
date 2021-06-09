const tape = require('tape')
const cont = require('cont')
const pull = require('pull-stream')
const crypto = require('crypto')
const ssbKeys = require('ssb-keys')
const SecretStack = require('secret-stack')
const u = require('./misc/util')

const createSbot = SecretStack({
  caps: { shs: crypto.randomBytes(32).toString('base64') }
})
  .use(require('ssb-db'))
  .use({
    // fake replicate plugin
    name: 'replicate',
    init: function () {
      return { request: function () {} }
    }
  })
  .use(require('../')) // EBT

function Delay (d) {
  d = d || 100
  return pull.asyncMap(function (data, cb) {
    setTimeout(function () {
      cb(null, data)
    }, ~~(d + Math.random() * d))
  })
}

const alice = ssbKeys.generate()
const bob = ssbKeys.generate()
const charles = ssbKeys.generate()

const botA = createSbot({
  temp: 'random-animals_alice',
  port: 45451,
  host: 'localhost',
  timeout: 20001,
  replicate: { legacy: false },
  keys: alice,
  gossip: { pub: false },
  friends: { hops: 10 }
})

const botB = createSbot({
  temp: 'random-animals_bob',
  port: 45452,
  host: 'localhost',
  timeout: 20001,
  replicate: { legacy: false },
  friends: { hops: 10 },
  gossip: { pub: false },
  keys: bob
})

const botC = createSbot({
  temp: 'random-animals_charles',
  port: 45453,
  host: 'localhost',
  timeout: 20001,
  replicate: { legacy: false },
  friends: { hops: 10 },
  gossip: { pub: false },
  keys: charles
})

const feeds = [botA, botB, botC]
// make sure all the sbots are replicating all the feeds.
feeds.forEach(function (f) {
  botA.replicate.request(f.id)
  botB.replicate.request(f.id)
  botC.replicate.request(f.id)
})

const all = {}
const recv = {}

function consistent (name) {
  if (!name) throw new Error('name must be provided')
  recv[name] = {}
  return function (msg) {
    recv[name][msg.key] = true
    let missing = 0
    let has = 0
    for (const k in all) {
      for (const n in recv) {
        if (!recv[n][k]) missing++
        else has++
      }
    }

    u.log('missing/has', missing, has)
    if (!missing) { u.log('CONSISTENT!!!') }
  }
}

botA.post(consistent('alice'))
botB.post(consistent('bob'))
botC.post(consistent('charles'))

cont.para(feeds.map(function (f) {
  return function (cb) {
    return f.publish({ type: 'post', text: 'hello world' }, cb)
  }
}))(function () {
  function log (name) {
    return pull.through(function (data) {
      u.log(name, data)
    })
  }

  function peers (a, b, name1, name2, d) {
    const repA = a.ebt.replicate.call({ id: name2 }, { version: 2 })
    const repB = b.ebt.replicate.call({ id: name1 }, { version: 2 })

    pull(
      repA,
      Delay(d),
      log(name1 + '->' + name2),
      repB,
      Delay(d),
      log(name2 + '->' + name1),
      repA
    )
  }

  peers(botA, botB, 'a', 'b', 10)
  peers(botA, botC, 'a', 'c', 10)
  peers(botC, botB, 'c', 'b', 7)
})

let passed = false
let i = 10
const int = setInterval(function () {
  u.log('post', botA.since())
  const N = ~~(Math.random() * feeds.length)
  u.log('APPEND', N)
  feeds[N].publish({ type: 'post', text: new Date().toString() }, () => {})
  if (--i) return
  clearInterval(int)

  u.log('Alice', botA.since())
  u.log('Bob', botB.since())
  u.log('Charles', botC.since())

  // and check that all peers are consistent.
  setTimeout(function () {
    u.log('close')
    botA.close()
    botB.close()
    botC.close()
    passed = true
  }, 1000)
}, 500)

// TODO refactor this entirely file, it should be using tape

tape('TODO name this test', function (t) {
  t.timeoutAfter(10e3)
  let int = setInterval(() => {
    if (passed) {
      clearInterval(int)
      t.end()
    }
  }, 500)
})