'use strict'
var Obv = require('obv')
var pull = require('pull-stream')
var pContDuplex = require('pull-cont/duplex')
var EBTStream = require('epidemic-broadcast-trees')
var Store = require('lossy-store')
var path = require('path')
var Bounce = require('epidemic-broadcast-trees/bounce')

var shouldReplicate = require('./follows').shouldReplicate


//var createReplicator = require('./stream')

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

function hook(hookable, fn) {
  if('function' === typeof hookable && hookable.hook)
    hookable.hook(fn)
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

  var _store = Store(config.path ? path.join(config.path, 'ebt') : null)

  var store = {
    ensure: function (key, cb) {
      clock.once(function () {
        _store.ensure(key, cb)
      })
    },
    get: function (key) {
      return _store.get(toUrlFriendly(key))
    },
    set: function (key, value) {
      return _store.set(toUrlFriendly(key), value)
    }
  }
  var following = {}
  var clock = require('./clock')(sbot)
  var status = {}
  var streams = {}

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
    for(var k in streams) {
      if(state !== isFollowing(streams[k].states[id])) {
        streams[k].request(id, state ? clock.value[id] || 0 : -1)
      }
    }
  }

  //HACK: patch calls to replicate.request into ebt, too.
  hook(sbot.replicate.request, function (fn, args) {
    request.apply(null, args)
    return fn.apply(this, args)
  })

  //this should be always up to date...

  sbot.post(appended.set)

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
    if('function' === typeof opts)
      callback = opts, opts = null
    if(!opts || opts.version !== 2)
      throw new Error('expected ebt.replicate({version: 2})')
    var other = this.id

    var stream = streams[other] = createStream({
      onChange: Bounce(function () {
        //TODO: log progress in some way, here
        //maybe save progress to a object, per peer.
        status[other] = status[other] || {}
        status[other].progress = streams[other].progress()
        status[other].feeds = countKeys(streams[other].states)
        update(other, streams[other].states)
      }, 200),
      onRequest: function (id, seq) {
        //incase this is one we skipped, but the remote has an update
        stream.request(id, following[id] ? clock.value[id]|0 : -1)
      }
    },  function (err) {
      //remember their clock, so we can skip requests next time.
      update(other, streams[other].states)
      cb && cb(err)
    })

    store.ensure(other, function () {
      var _clock = store.get(other)
      status[other].req =
        shouldReplicate(following, _clock, clock.value, stream.request)
      stream.next()
    })

    return stream
  }

  appended(function (data) {
    for(var k in streams)
      streams[k].onAppend(data.value)
  })


  hook(sbot.status, function (fn) {
    var _status = fn(), feeds = 0
    _status.ebt = status
    for(var k in streams) {
        status[k].progress = streams[k].progress()
        status[k].meta = streams[k].meta
    }

    return _status
  })

  function progressReduce (acc, item) {
    acc.start += item.start
    acc.current += item.current
    acc.target += item.target
    return acc
  }

  hook(sbot.progress, function (fn) {
    var prog = fn()
    var p = {start: 0, current: 0, target: 0}
    for(var k in streams)
      p = progressReduce(p, streams[k].progress())
    if(p.target)
      prog.ebt = p
    return prog
  })

  sbot.on('rpc:connect', function (rpc, isClient) {
    if(isClient) {
      var opts = {version: 2}
      var a = replicate.call(rpc, opts, function (err) {
        if(!rpc.closed) {
          console.log('EBT failed, fallback to legacy', err)
          rpc._emit('fallback:replicate', err) //trigger legacy replication
        }
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
    request: function (id, follows) {
      clock.once(function () {
        request(id, follows)
      })
    },
    _dump: require('./debug/local')(sbot) //just for performance testing. not public api
  }
}

