const tape = require('tape')
const cont = require('cont')
const pull = require('pull-stream')
const crypto = require('crypto')
const ssbKeys = require('ssb-keys')
const SecretStack = require('secret-stack')
const u = require('./util')

const createSsbServer = SecretStack({
  caps: { shs: crypto.randomBytes(32).toString('base64') }
})
  .use(require('ssb-db'))
  .use(require('ssb-replicate'))
  .use(require('..'))
  .use(require('ssb-friends'))

function createHistoryStream (sbot, opts) {
  return pull(
    sbot.createLogStream({ keys: false, live: opts.live }),
    pull.filter((msg) => msg.author === opts.id)
  )
}

tape('replicate between 3 peers', function (t) {
  const bob = createSsbServer({
    temp: 'test-bob',
    //      port: 45452, host: 'localhost',
    replicate: { legacy: false },
    keys: ssbKeys.generate()
  })

  const alice = createSsbServer({
    temp: 'test-alice',
    //    port: 45453, host: 'localhost',
    seeds: [bob.getAddress()],
    replicate: { legacy: false },
    keys: ssbKeys.generate()
  })

  cont.para([
    cont(alice.publish)(u.follow(bob.id)),
    cont(bob.publish)(u.follow(alice.id))
  ])(function (err) {
    if (err) throw err

    alice.connect(bob.getAddress(), function (_, _rpc) {
    })

    const ary = []
    pull(
      createHistoryStream(bob, { id: alice.id, live: true }),
      pull.drain(function (data) {
        u.log(data)
        ary.push(data)
      })
    )
    let l = 12
    setTimeout(function next () {
      if (!--l) {
        pull(
          createHistoryStream(bob, { id: alice.id, live: false }),
          pull.collect(function (err, _ary) {
            t.error(err)
            t.equal(_ary.length, 12)
            t.deepEqual(ary, _ary)
            bob.close(true)
            alice.close(true)
            t.end()
          })
        )
      } else {
        alice.publish({ type: 'test', value: new Date() },
          function (err, msg) {
            if (err) throw err
            u.log('added', msg.key, msg.value.sequence)
            setTimeout(next, 200)
          })
      }
    }, 200)
  })
})
