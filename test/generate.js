const tape = require('tape')
const gen = require('ssb-generate')
const assert = require('assert')
const crypto = require('crypto')
const ssbKeys = require('ssb-keys')
const SecretStack = require('secret-stack')
const u = require('./util')

const createSbot = SecretStack({
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
      u.log(name, l, l - _l, bot.progress())
      _l = l
    }
  }, 1000).unref()
}

// SOMETIMES this test fails. I think it's just because
// some of the peers might be too far from the followed peer.
// TODO: create a thing that checks they where all actually reachable!

const alice = ssbKeys.generate()

const timeout = 2000

const botA = createSbot({
  temp: 'alice',
  port: 55451,
  host: 'localhost',
  timeout: timeout,
  replicate: { hops: 3, legacy: false },
  keys: alice
})

u.log('address?', botA.getAddress())
if (!botA.getAddress()) {
  throw new Error('a_bot has not address?')
}

const botB = createSbot({
  temp: 'bob',
  port: 55452,
  host: 'localhost',
  timeout: timeout,
  replicate: { hops: 3, legacy: false },
  keys: ssbKeys.generate()
})

botA.publish({
  type: 'contact',
  contact: botB.id,
  following: true
}, function () {})

track(botA, 'alice')
track(botB, 'bob')

tape('generates feeds and tests EBT replication', function (t) {
  gen.initialize(botA, 20, 3, function (err, peers) {
    if (err) throw err
    u.log('initialized')
    gen.messages(
      function (n) {
        if (Math.random() < 0.3) {
          return {
            type: 'contact',
            contact: randary(peers).id,
            following: true,
          }
        }
        return {
          type: 'test',
          ts: Date.now(),
          random: Math.random(),
          value: randbytes(randint(1024)).toString('base64'),
        }
      },
      peers,
      200,
      function () {
        let ready = false
        u.log('set up, replicating')
        ;(function next(i) {
          if (!i) {
            ready = true
            return
          }
          const other = randary(peers).id
          u.log('b_bot.publish', { follow: other })
          botB.publish(
            {
              type: 'contact',
              contact: other,
              following: true,
            },
            function (err, msg) {
              if (err) throw err
              next(i - 1)
            },
          )
        })(50)

        botB.connect(botA.getAddress(), function (err) {
          u.log('A<-->B')
          if (err) throw err
          const int = setInterval(function () {
            const prog = botA.progress()
            u.log('assertions', ready)
            assert.ok(prog.indexes)
            assert.ok(prog.ebt)
            assert.ok(prog.ebt.target)
            if (!ready) return

            u.log('GET VECTOR CLOCK', botA.status())
            botA.getVectorClock(function (err, clock) {
              if (err) throw err
              botB.getVectorClock(function (err, _clock) {
                if (err) throw err
                let different = 0
                function count(o) {
                  let t = 0
                  let s = 0
                  for (const k in o) {
                    t++
                    s += o[k]
                  }
                  return { total: t, sum: s }
                }

                for (const k in _clock) {
                  if (clock[k] !== _clock[k]) {
                    different += (clock[k] || 0) - _clock[k]
                  }
                }

                u.log('A', count(clock), 'B', count(_clock), 'diff', different)
                if (different === 0) {
                  const prog = botA.progress()
                  assert.ok(prog.indexes)
                  assert.ok(prog.ebt)
                  assert.ok(prog.ebt.target)
                  assert.strictEqual(prog.ebt.current, prog.ebt.target)
                  clearInterval(int)
                  botA.close()
                  botB.close()
                  t.end()
                } else {
                  t.fail('inconsistent: ' + JSON.stringify(botA.status().ebt))
                }
              })
            })
          }, 1000)
        })
      },
    )
  })
})
