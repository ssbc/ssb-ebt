var Obv = require('obv')
var pull = require('pull-stream')
var pContDuplex = require('pull-cont/duplex')
var EBTStream = require('epidemic-broadcast-trees')

exports.name = 'ebt'

exports.version = '1.0.0'

exports.manifest = { replicate: 'duplex', _dump: 'source'}
exports.permissions = {
    anonymous: {allow: ['replicate']},
  }

exports.init = function (sbot, config) {
  var id = sbot.id.substring(0, 8)
  var appended = Obv()

  //messages appended in realtime.
  sbot.post(appended.set)
  var ts = Date.now(), start = Date.now()

  var createStream = EBTStream(
    function get (id, seq, cb) {
      sbot.getAtSequence([id, seq], function (err, data) {
        cb(null, data && data.value || data)
      })
    },
    function append (msg, cb) {
      sbot.add(msg, function (err) {
        cb()
      })
    }
  )

  function getRemoteVectorClock(remote, cb) { cb(null, {}) }

  function replicate (opts, callback) {
    if(!callback) callback = opts, opts = {version: 1}
    if(opts && opts.version > 1)
      return pContDuplex(function (cb) {
        cb(new Error('unsupported version of ebt.replicate'))
      })

    var stream = createStream({
      onChange: function (prog) {
        //not everytime, but sometimes, update the remoteVectorClock
        console.log(prog)
      }
    },
      callback || function (err) {
        console.log('Error (on ebt stream):', err.stack)
      }
    )

    appended(function (data) {
      stream.onAppend(data.value)
    })

    sbot.getVectorClock(function (err, clock) {
      if(err) return cb(err)
      //TODO: compare with the feeds we know they have...
      //basically, when we are in sync, write their vector clock to an atomic file.
      //on startup, read that, and only request feeds where our seq != their seq.
      //unless they explicitly said they didn't want it.
      //request anything we don't know they have.
      getRemoteVectorClock(this.id, function (_, remoteClock) {
        var _clock = {}
      //  if(remoteClock) {
          for(var k in clock)
            if(remoteClock[k] != clock[k])
              stream.request(k, clock[k])
//              _clock[k] = clock[k]
        //}
  //      else
    //      _clock = clock

      })
    })


//    return pContDuplex(function (cb) {
//      //TODO:
//      //check if we have connected to this peer before,
//      //and if so, get their previous requested clock.
//      //then we can make the handshake very small.
//      sbot.getVectorClock(function (err, clock) {
//        if(err) return cb(err)
//        //TODO: compare with the feeds we know they have...
//        //basically, when we are in sync, write their vector clock to an atomic file.
//        //on startup, read that, and only request feeds where our seq != their seq.
//        //unless they explicitly said they didn't want it.
//        //request anything we don't know they have.
//        getRemoteVectorClock(this.id, function (_, remoteClock) {
//          var _clock = {}
//          if(remoteClock) {
//            for(var k in clock)
//              if(remoteClock[k] != clock[k])
//                _clock[k] = clock[k]
//          }
//          else
//            _clock = clock
//
//          var stream = createStream({
//            seqs: _clock,
//            onChange: function (prog) {
//              //not everytime, but sometimes, update the remoteVectorClock
//              console.log(prog)
//            }
//          },
//            callback || function (err) {
//              console.log('Error (on ebt stream):', err.stack)
//            }
//          )
//
//          appended(function (data) {
//            stream.onAppend(data.value)
//          })
//
//          cb(null, stream)
//        })
//      })
//    })
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
    _dump: require('./debug/local')(sbot) //just for performance testing. not public api
  }
}




