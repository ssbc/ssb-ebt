'use strict'
var Obv = require('obv')
var pull = require('pull-stream')
var pContDuplex = require('pull-cont/duplex')
var EBTStream = require('epidemic-broadcast-trees')
var Store = require('lossy-store')
var path = require('path')
var Bounce = require('epidemic-broadcast-trees/bounce')

function isEmpty (o) {
  for(var k in o) return false
  return true
}

exports.name = 'ebt'

exports.version = '1.0.0'

exports.manifest = {
  replicate: 'duplex',
  _dump: 'source',
  request: 'sync',
}
exports.permissions = {
    anonymous: {allow: ['replicate']},
  }

exports.init = function (sbot, config) {
  var appended = Obv()
  config.replicate = config.replicate || {}
  config.replicate.fallback = true
  var store = Store(config.path ? path.join(config.path, 'ebt') : null)

  var clock = {}, following = {}, streams = {}

  function request (id, state) {
    state = state !== false //true unless explicitly false
    if(following[id] === state) return
    following[id] = state
    //start all current streams following this one.
    ready(function () {
      for(var k in streams) {
        if(!streams[k].states[id])
          streams[k].request(id, state ? clock[id] || 0 : -1)
      }
    })
  }

  //HACK: patch calls to replicate.request into ebt, too.
  sbot.replicate.request.hook(function (fn, args) {
    request.apply(null, args)
    fn.apply(this, args)
  })

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

  //messages appended in realtime.
  sbot.post(function (msg) {
    //ensure the clock object is always up to date, once loaded.
    var v = msg.value
    if(clock[v.author] == null || clock[v.author] < v.sequence)
      clock[v.author] = v.sequence
    appended.set(msg)
  })


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


  var ts = Date.now(), start = Date.now()

  function update (id, states) {
    store.ensure(id, function () {
      var _clock = store.get(id) || {}
      for(var k in states)
        if(states[k].remote.req != null)
          _clock[k] = states[k].remote.req
      if(!isEmpty(_clock)) store.set(id, _clock)
    })
  }

  function replicate (opts, callback) {
    if('function' === typeof opts) callback = opts, opts = null
    var other = this.id
    if(!opts || opts.version !== 2) {
      throw streamError(new Error('expected ebt.replicate({version: 2})'))
    }

    var stream = streams[other] = createStream({
      onChange: Bounce(function () {
        //TODO: log progress in some way, here
        //maybe save progress to a object, per peer.
        var prog = stream.progress()
        update(other, stream.states)
      }, 200),
      onRequest: function (id, seq) {
        //incase this is one we skipped, but the remote has an update
        if(following[id])
          stream.request(id, clock[id]|0)
        else
          stream.request(id, -1)

      }
    },
      function (err) {
        //remember their clock, so we can skip requests next time.
        update(other, stream.states)
        callback && callback(err)
      }
    )

    appended(function (data) {
      stream.onAppend(data.value)
    })

    store.ensure(other, function () {
      var _clock = store.get(other)
      ready(function () {
        for(var k in following) {
          if(following[k] == true) {
            if(!_clock || !(_clock[k] == -1 || _clock[k] == clock[k]))
              stream.request(k, clock[k] || 0, false)
          }
        }
        stream.next()
      })
    })

    return stream
  }

  sbot.on('rpc:connect', function (rpc, isClient) {
    if(isClient) {
      var opts = {version: 2}
      var a = replicate.call(rpc, opts, function (err) {
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
    request: request,
    _dump: require('./debug/local')(sbot) //just for performance testing. not public api
  }
}



