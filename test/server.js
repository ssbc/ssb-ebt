const tape = require('tape')
const cont = require('cont')
const deepEqual = require('deep-equal')
const crypto = require('crypto')
const ssbKeys = require('ssb-keys')
const SecretStack = require('secret-stack')
const u = require('./util')

// create 3 servers
// give them all pub servers (on localhost)
// and get them to follow each other...

const createSsbServer = SecretStack({
  caps: { shs: crypto.randomBytes(32).toString('base64') }
})
  .use(require('ssb-db'))
  .use(require('ssb-replicate'))
  .use(require('..'))
  .use(require('ssb-friends'))
  .use(require('ssb-gossip'))

tape('replicate between 3 peers', function (t) {
  let alice, bob, carol
  const dbA = createSsbServer({
    temp: 'server-alice',
    port: 45451,
    timeout: 1400,
    keys: alice = ssbKeys.generate(),
    replicate: { legacy: false },
    gossip: { pub: false },
    level: 'info'
  })
  const dbB = createSsbServer({
    temp: 'server-bob',
    port: 45452,
    timeout: 1400,
    keys: bob = ssbKeys.generate(),
    seeds: [dbA.getAddress()],
    replicate: { legacy: false },
    gossip: { pub: false },
    level: 'info'
  })
  const dbC = createSsbServer({
    temp: 'server-carol',
    port: 45453,
    timeout: 1400,
    keys: carol = ssbKeys.generate(),
    seeds: [dbA.getAddress()],
    replicate: { legacy: false },
    gossip: { pub: false },
    level: 'info'
  })

  const apub = cont(dbA.publish)
  const bpub = cont(dbB.publish)
  const cpub = cont(dbC.publish)

  cont.para([
    apub(u.pub(dbA.getAddress())),
    bpub(u.pub(dbB.getAddress())),
    cpub(u.pub(dbC.getAddress())),

    apub(u.follow(bob.id)),
    apub(u.follow(carol.id)),

    bpub(u.follow(alice.id)),
    bpub(u.follow(carol.id)),

    cpub(u.follow(alice.id)),
    cpub(u.follow(bob.id))
  ])(function (err, ary) {
    if (err) throw err

    const expected = {}
    expected[alice.id] = expected[bob.id] = expected[carol.id] = 3
    function check (server, name) {
      let closed = false
      const int = setInterval(function () {
        server.getVectorClock(function (err, actual) {
          if (err) throw err
          if (closed) return
          console.log(actual)
          if (deepEqual(expected, actual)) {
            clearInterval(int)
            closed = true
            done()
          }
        })
      }, 1000)
    }

    check(dbA, 'ALICE')
    check(dbB, 'BOB')
    check(dbC, 'CAROL')

    let n = 3

    function done () {
      if (--n) return
      dbA.close(true)
      dbB.close(true)
      dbC.close(true)
      t.ok(true)
      t.end()
    }
  })
})
