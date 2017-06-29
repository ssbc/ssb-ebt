'use strict'
var Obv = require('obv')
var pull = require('pull-stream')
var pContDuplex = require('pull-cont/duplex')
var EBTStream = require('epidemic-broadcast-trees')
var Store = require('lossy-store')
var path = require('path')
var Bounce = require('epidemic-broadcast-trees/bounce')

var toUrlFriendly = require('base64-url').escape

function isEmpty (o) {
  for(var k in o) return false
  return true
}

function countKeys (o) {
  var n = 0
  for(var k in o) n++
  return n
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
  var status = {}
  var clock = {}, following = {}, streams = {}

  function isFollowing (state) {
    return (
        state == null ? false
      : state.local.req == null ? false
      : state.local.req !== -1
    )
  }

  function request (id, state) {
    state = state !== false //true unless explicitly false
    if(following[id] === state) return
    following[id] = state
    //start all current streams following this one.
    ready(function () {
      for(var k in streams) {
        if(state !== isFollowing(streams[k].states[id])) {
          streams[k].request(id, state ? clock[id] || 0 : -1)
        }
      }
    })
  }

  //HACK: patch calls to replicate.request into ebt, too.
  sbot.replicate.request.hook(function (fn, args) {
    request.apply(null, args)
    return fn.apply(this, args)
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
    id = toUrlFriendly(id)
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
      throw new Error('expected ebt.replicate({version: 2})')
    }

    status[other] = {}

    var stream = streams[other] = createStream({
      onChange: Bounce(function () {
        //TODO: log progress in some way, here
        //maybe save progress to a object, per peer.
        status[other] = status[other] || {}
        status[other].progress = stream.progress()
        status[other].feeds = countKeys(streams[other].states)
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

    var _other = toUrlFriendly(other)
    store.ensure(_other, function () {
      var _clock = store.get(_other)
      status[other] = status[other] || {}
      var req = status[other].req = {
        total:countKeys(following),
        common: 0,
        requested: 0
      }

      if(_clock) {
        for(var k in _clock) {
          if(following[k])
            req.common++
          else
            req.total++
        }
      }

      ready(function () {
        for(var k in following) {
          if(following[k] == true) {
            if(!_clock || !(_clock[k] == -1 || _clock[k] == (clock[k] || 0))) {
              req.requested ++
              stream.request(k, clock[k] || 0, false)
            }
          }
        }
        stream.next()
      })
    })

    return stream
  }

  if('function' === typeof sbot.status && sbot.status.hook)
    sbot.status.hook(function (fn) {
      var _status = fn(), feeds = 0
      _status.ebt = status
      for(var k in streams) {
          status[k].progress = streams[k].progress()
          status[k].meta = streams[k].meta
      }

      return _status
    })

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

