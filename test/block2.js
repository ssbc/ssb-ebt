var cont = require('cont')
var tape = require('tape')
var ssbKeys = require('ssb-keys')
var u = require('./util')

var createSsbServer = require('ssb-server')
    .use(require('ssb-replicate'))
    .use(require('ssb-friends'))
    .use(require('..'))

var alice = createSsbServer({
    temp: 'test-block-alice', //timeout: 1400,
    keys: ssbKeys.generate(),
    replicate: {legacy: false},
    gossip: {pub: false},
  })

var bob = createSsbServer({
    temp: 'test-block-bob', //timeout: 600,
    keys: ssbKeys.generate(),
    replicate: {legacy: false},
    gossip: {pub: false},
  })

tape('alice blocks bob while he is connected, she should disconnect him', function (t) {

  //in the beginning alice and bob follow each other
  cont.para([
    cont(alice.publish)(u.follow(bob.id)),
    cont(bob  .publish)(u.follow(alice.id))
  ]) (function (err) {
    if(err) throw err

    bob.connect(alice.getAddress(), function (err, rpc) {
      if(err) throw err
      //replication will begin immediately.
    })

    bob.on('replicate:finish', function (vclock) {
      console.log(vclock)
      t.equal(vclock[alice.id], 1)
      alice.close()
      bob.close()
      t.end()
    })

    var once = false
    bob.post(function (op) {
      console.log('BOB RECV', op)
      if(once) throw new Error('should only be called once')
      once = true
      //should be the alice's follow(bob) message.

      t.equal(op.value.content.contact, bob.id)
      cont(alice.publish)(u.block(bob.id))(function (err) {
        if(err) throw err
      })
    }, false)
  })
})
