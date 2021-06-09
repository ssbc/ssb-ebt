const tape = require('tape')
const cont = require('cont')
const crypto = require('crypto')
const ssbKeys = require('ssb-keys')
const SecretStack = require('secret-stack')
const u = require('./misc/util')

const createSsbServer = SecretStack({
  caps: { shs: crypto.randomBytes(32).toString('base64') }
})
  .use(require('ssb-db'))
  .use(require('ssb-replicate'))
  .use(require('ssb-friends'))
  .use(require('..'))

const alice = createSsbServer({
  temp: 'test-block-alice', // timeout: 1400,
  keys: ssbKeys.generate(),
  replicate: { legacy: false },
  gossip: { pub: false }
})

const bob = createSsbServer({
  temp: 'test-block-bob', // timeout: 600,
  keys: ssbKeys.generate(),
  replicate: { legacy: false },
  gossip: { pub: false }
})

tape('alice blocks bob while he is connected, she should disconnect him', function (t) {
  // in the beginning alice and bob follow each other
  cont.para([
    cont(alice.publish)(u.follow(bob.id)),
    cont(bob.publish)(u.follow(alice.id))
  ])(function (err) {
    if (err) throw err

    bob.connect(alice.getAddress(), function (err, rpc) {
      if (err) throw err
      // replication will begin immediately.
    })

    bob.on('replicate:finish', function (vclock) {
      u.log(vclock)
      t.equal(vclock[alice.id], 1)
      alice.close()
      bob.close()
      t.end()
    })

    let once = false
    bob.post(function (op) {
      u.log('BOB RECV', op)
      if (once) throw new Error('should only be called once')
      once = true
      // should be the alice's follow(bob) message.

      t.equal(op.value.content.contact, bob.id)
      cont(alice.publish)(u.block(bob.id))(function (err) {
        if (err) throw err
      })
    }, false)
  })
})
