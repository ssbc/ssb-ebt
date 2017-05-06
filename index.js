'use strict'
var Obv = require('obv')
var pull = require('pull-stream')
var pContDuplex = require('pull-cont/duplex')
var EBTStream = require('epidemic-broadcast-trees')

function streamError(err) {
  if(!err) throw new Error('expected error')
  console.log('stream error', err)
  return pContDuplex(function (cb) {
    cb(err)
  })
}

exports.name = 'ebt'

exports.version = '1.0.0'

exports.manifest = { replicate: 'duplex', _dump: 'source'}
exports.permissions = {
    anonymous: {allow: ['replicate']},
  }

exports.init = function (sbot, config) {
  var id = sbot.id.substring(0, 8)
  var appended = Obv()

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

  //messages appended in realtime.
  sbot.post(appended.set)
  var ts = Date.now(), start = Date.now()

  function getRemoteVectorClock(remote, cb) { cb(null, {}) }

  function replicate (opts, callback) {
    if('function' === typeof opts) callback = opts, opts = null
    var other = this.id
    if(!opts || opts.version !== 2) {
      return streamError(new Error('expected ebt.replicate({version: 2})'))
    }

    var stream = createStream({
      onChange: function () {
        //TODO: log progress in some way, here
        //maybe save progress to a object, per peer.
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
      getRemoteVectorClock(other, function (_, remoteClock) {
        for(var k in clock)
          if(remoteClock[k] != clock[k])
            stream.request(k, clock[k])
      })
    })

    return stream
  }

  sbot.on('rpc:connect', function (rpc, isClient) {
    if(isClient) {
      var opts = {version: 2}
      var a = replicate(opts, function (err) {
        console.log('EBT failed, fallback to legacy', err)
        rpc._emit('fallback:replicate', err) //trigger legacy replication
      })
      var b = rpc.ebt.replicate(opts, function (err) {
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






