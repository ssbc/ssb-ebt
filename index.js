var Obv = require('obv')
var pull = require('pull-stream')
var pContDuplex = require('pull-cont/duplex')
var EBTStream = require('epidemic-broadcast-trees')
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

  return {
    replicate: function () {
      return pContDuplex(function (cb) {
        ssb.getVectorClock(function (err, clock) {
          if(err) return cb(err)
          //TODO: compare with the feeds we know they have...
          //basically, when we are in sync, write their vector clock to an atomic file.
          //on startup, read that, and only request feeds where our seq != their seq.
          //unless they explicitly said they didn't want it.
          //request anything we don't know they have.
          var stream = EBTStream(
            clock,
            function get (id, seq, cb) {
              ssb.getAtSequence([id, seq], function (err, data) {
                cb(null, data && data.value || data)
              })
            },
            ssb.add //append
          )

          appended(function (data) {
            stream.onAppend(data.value)
          })

          cb(null, stream)
        })
      })
    }
  }
}

