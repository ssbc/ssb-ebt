'use strict'
var Obv = require('obv')
var pull = require('pull-stream')
var pContDuplex = require('pull-cont/duplex')
var EBTStream = require('epidemic-broadcast-trees')
var Store = require('lossy-store')
var path = require('path')

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

  var store = Store(config.path ? path.join(config.path, 'ebt') : null)

  var clock = {}, following = {}, streams = {}

  //this should be always up to date...
  var waiting = []
  sbot.getVectorClock(function (err, _clock) {
    clock = _clock
    while(waiting.length) waiting.shift()()
  })

  function ready(fn) {
    if(clock) fn()
    else waiting.push(fn)
  }

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
  sbot.post(function (msg) {
    //ensure the clock object is always up to date, once loaded.
//    if(clock[msg.author] && clock[msg.author] < msg.sequence)
//      clock[msg.author] = msg.sequence
    appended.set(msg)
  })
  var ts = Date.now(), start = Date.now()

  function replicate (opts, callback) {
    if('function' === typeof opts) callback = opts, opts = null
    var other = this.id
    if(!opts || opts.version !== 2) {
      return streamError(new Error('expected ebt.replicate({version: 2})'))
    }

    var stream = streams[other] = createStream({
      onChange: function () {
        //TODO: log progress in some way, here
        //maybe save progress to a object, per peer.
      },
      onRequest: function (id, seq) {
        //incase this is one we skipped, but the remote has an update
        
        if(true || following[id]) stream.request(id, clock[id]|0)
      }
    },
      function (err) {
        //remember their clock, so we can skip requests next time.
        var _clock = store.get(id)
        for(var k in stream.state)
          if(stream.state[k].remote.req != null)
            _clock[k] = stream.state[k].remote.req

        store.set(id, _clock)
        callback(err)
      }
    )

    appended(function (data) {
      stream.onAppend(data.value)
    })

    store.ensure(other, function () {
      var _clock = store.get(id)

      ready(function () {
        for(var k in clock) {
          if(following[k] && !_clock || _clock[k] != clock[k])
            stream.request(k, clock[k])
        }
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

    //local only; sets feeds that will be replicated.
    //this is only set for the current session. other plugins
    //need to manage who is actually running it.
    request: function (id) {
      if(following[id]) return
      following[id] = true
      //start all current streams following this one.
      ready(function () {
        for(var k in streams) {
          if(!streams[k].state[id])
            streams[k].request(id, clock[id])
        }
      })
    },
    _dump: require('./debug/local')(sbot) //just for performance testing. not public api
  }
}







