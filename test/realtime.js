var cont      = require('cont')
var deepEqual = require('deep-equal')
var tape      = require('tape')
var pull      = require('pull-stream')
var u         = require('./util')
var crypto    = require('crypto')

var ssbKeys = require('ssb-keys')

var createSsbServer = require('secret-stack')({
    caps: {shs: crypto.randomBytes(32).toString('base64')}
  })
  .use(require('ssb-db'))
  .use(require('ssb-replicate'))
  .use(require('..'))
  .use(require('ssb-friends'))

function createHistoryStream(sbot, opts) {
  return pull(
    sbot.createLogStream({keys: false, live: opts.live}),
    pull.filter(function (msg) {
      return msg.author == opts.id
    })
  )
}

tape('replicate between 3 peers', function (t) {

  var bob = createSsbServer({
      temp: 'test-bob',
//      port: 45452, host: 'localhost',
      replicate: {legacy: false},
      keys: ssbKeys.generate()
    })

  var alice = createSsbServer({
      temp: 'test-alice',
  //    port: 45453, host: 'localhost',
      seeds: [bob.getAddress()],
      replicate: {legacy: false},
      keys: ssbKeys.generate()
    })

  cont.para([
    cont(alice.publish)(u.follow(bob.id)),
    cont(bob.publish)(u.follow(alice.id))
  ])(function (err) {
    if(err) throw err

    var rpc
    alice.connect(bob.getAddress(), function (_, _rpc) {
      rpc = _rpc
    })

    var ary = []
    pull(
      createHistoryStream(bob, {id: alice.id, live: true}),
      pull.drain(function (data) {
        console.log(data)
        ary.push(data);
      })
    )
    var l = 12
    setTimeout(function next () {
      if(!--l) {
        var _ary = []
          pull(
            createHistoryStream(bob, {id: alice.id, live: false}),
            pull.collect(function (err, _ary) {
              t.equal(_ary.length, 12)
              t.deepEqual(ary,_ary)
              bob.close(true); alice.close(true); t.end()
            })
          )
      }
      else
        alice.publish({type: 'test', value: new Date()},
          function (err, msg){
            if(err) throw err
            console.log('added', msg.key, msg.value.sequence)
            setTimeout(next, 200)
          })
    }, 200)

  })
})
