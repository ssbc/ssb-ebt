var Obv = require('obv')
var pull = require('pull-stream')
var pContDuplex = require('pull-cont/duplex')
var EBTStream = require('epidemic-broadcast-trees/stream')
var EBTState = require('epidemic-broadcast-trees/state')
exports.name = 'ebt'

exports.version = '1.0.0'

exports.manifest = { replicate: 'duplex' }

exports.init = function (ssb, config) {
  var id = ssb.id.substring(0, 8)
  var appended = Obv()

  //messages appended in realtime.
  pull(
    ssb.createLogStream({old: false}),
    pull.drain(appended.set)
  )

//  appended(function (msg) {
//    console.log(ssb.id, msg.value.author, msg.value.sequence)
//  })

  return {
    replicate: function () {
      return pContDuplex(function (cb) {
        ssb.seq(function (err, seqs) {
          //TODO: compare with the feeds we know they have...
          //basically, when we are in sync, write their vector clock to an atomic file.
          //on startup, read that, and only request feeds where our seq != their seq.
          //unless they explicitly said they didn't want it.
          //request anything we don't know they have.
          var states = {}
          for(var k in seqs)
            states[k] = EBTState.init(seqs[k])

          var stream = EBTStream(states, function get (id, seq, cb) {
            ssb.clock([id, seq], function (err, data) {
              cb(null, data.value)
            })
          }, function append (msg, cb) {
            ssb.add(msg, function (err, data) {
              cb()
            })
          }, id)
          appended(function (data) {
            stream.onAppend(data.value)
            //console.log(states)
          })

          cb(null, stream)
        })
      })
    }
  }
}











