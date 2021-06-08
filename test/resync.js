const gen = require('ssb-generate')
const crypto = require('crypto')
const ssbKeys = require('ssb-keys')

const createSbot = require('secret-stack')({
  caps: { shs: crypto.randomBytes(32).toString('base64') }
})
  .use(require('ssb-db'))
  .use(require('ssb-replicate'))
  .use(require('../'))
  .use(require('ssb-friends'))

function randint (n) {
  return ~~(Math.random() * n)
}

function randary (a) {
  return a[randint(a.length)]
}

function randbytes (n) {
  return crypto.randomBytes(n)
}

function track (bot, name) {
  let l = 0
  let _l = 0
  bot.post(function (msg) {
    l++
  })
  setInterval(function () {
    if (_l !== l) {
      console.log(name, l, l - _l)
      _l = l
    }
  }, 1000).unref()
}

const alice = ssbKeys.generate()

const timeout = 2000

const botA = createSbot({
  temp: 'alice',
  port: 45451,
  host: 'localhost',
  timeout: timeout,
  replicate: { hops: 3, legacy: false },
  keys: alice
})

const bob = ssbKeys.generate()

console.log('address?', botA.getAddress())
if (!botA.getAddress()) { throw new Error('a_bot has not address?') }

const botB = createSbot({
  temp: 'bob',
  port: 45452,
  host: 'localhost',
  timeout: timeout,
  replicate: { hops: 3, legacy: false },
  keys: bob
})

botA.publish({
  type: 'contact',
  contact: botB.id,
  following: true
}, function () {})

track(botA, 'alice')
track(botB, 'bob')

//  b_bot.post(console.log)

gen.initialize(botA, 50, 4, function (err, peers) {
  if (err) throw err

  // in this test, bob's feed is on alice,
  // because bob's database corrupted (but had key backup)
  peers.push(botA.createFeed(bob))

  console.log('initialized')
  // console.log(peers.map(function (e) { return e.id }))
  gen.messages(function (n) {
    if (Math.random() < 0.3) {
      return {
        type: 'contact',
        contact: randary(peers).id,
        following: true
      }
    }
    return {
      type: 'test',
      ts: Date.now(),
      random: Math.random(),
      value: randbytes(randint(1024)).toString('base64')
    }
  }, peers, 1000, function () {
    console.log('done, replicating')
    botB.connect(botA.getAddress(), function (err) {
      if (err) throw err
      const int = setInterval(function () {
        console.log(JSON.stringify(botB.status().ebt))

        botA.getVectorClock(function (err, clock) {
          if (err) throw err
          botB.getVectorClock(function (err, _clock) {
            if (err) throw err
            let d = 0
            function count (o) {
              let t = 0
              let s = 0
              for (const k in o) {
                t++
                s += o[k]
              }
              return { total: t, sum: s }
            }
            let c = 0
            for (const k in _clock) {
              if (clock[k] !== _clock[k]) {
                d += (clock[k] || 0) - _clock[k]
              } else { c++ }
            }

            console.log('A', count(clock), 'B', count(_clock), 'diff', d, 'common', c)
            if (d === 0 && c) {
              clearInterval(int)
              console.log('close...')
              botA.close()
              botB.close()
            }
          })
        })
      }, 1000).unref()
    })
  })
})
