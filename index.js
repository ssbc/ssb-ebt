var Obv = require('obv')
var pull = require('pull-stream')
var pContDuplex = require('pull-cont/duplex')
var EBTStream = require('epidemic-broadcast-trees')

exports.name = 'ebt'

exports.version = '1.0.0'

exports.manifest = { replicate: 'duplex', _dump: 'source'}
exports.permissions = {
    anonymous: {allow: ['replicate']},
  },

exports.init = function (sbot, config) {
  var id = sbot.id.substring(0, 8)
  var appended = Obv()

  //messages appended in realtime.
  sbot.post(appended.set)
  var ts = Date.now(), _recv

  function replicate (_, callback) {
    if(!callback) callback = _
    return pContDuplex(function (cb) {
      //TODO:
      //check if we have connected to this peer before,
      //and if so, get their previous requested clock.
      //then we can make the handshake very small.
      sbot.getVectorClock(function (err, clock) {
        if(err) return cb(err)
        //TODO: compare with the feeds we know they have...
        //basically, when we are in sync, write their vector clock to an atomic file.
        //on startup, read that, and only request feeds where our seq != their seq.
        //unless they explicitly said they didn't want it.
        //request anything we don't know they have.
        var stream = EBTStream(
          clock,
          function get (id, seq, cb) {
            sbot.getAtSequence([id, seq], function (err, data) {
              cb(null, data && data.value || data)
            })
          },
          function (msg, cb) {
            sbot.add(msg, function (err) {
              cb()
            })
          }, //append
          function (prog) {
            //log replication progress, but not more than every second.
            var _ts = Date.now()
            if(_ts - ts > 1000) {
              console.log(prog, _recv - prog.recv)
              ts = _ts
              _recv = prog.recv
            }
          },
          callback || function (err) {
            console.log('Error (on ebt stream):', err.stack)
          }
        )

        appended(function (data) {
          stream.onAppend(data.value)
        })

        cb(null, stream)
      })
    })
  }

  sbot.on('rpc:connect', function (rpc, isClient) {
    if(isClient) {
      var a = replicate(function (err) {
        console.log('EBT failed, fallback to legacy', err)
        rpc._emit('fallback:replicate') //trigger legacy replication
      })
      var b = rpc.ebt.replicate(function (err) {
        console.log('replication ended:', rpc.id, err && err.stack)
      })
      pull(a, b, a)
    }
  })

  return {
    replicate: replicate,
    _dump: require('./dump/local')(sbot) //just for performance testing. not public api
  }
}



