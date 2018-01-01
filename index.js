'use strict'
var Obv = require('obv')
var pull = require('pull-stream')
var pContDuplex = require('pull-cont/duplex')
var EBTStream = require('epidemic-broadcast-trees')
var Bounce = require('epidemic-broadcast-trees/bounce')
var path = require('path')
var Follows = require('./follows')

var Store = require('lossy-store')
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

  var status = {}
  var clock = require('./clock')(sbot)

  var dir = config.path ? path.join(config.path, 'ebt') : null
  var store = Store(dir, null, toUrlFriendly)
  var follows = Follows(
    store,
    clock, status
  )

  //HACK: patch calls to replicate.request into ebt, too.
  hook(sbot.replicate.request, function (fn, args) {
    follows.request(args[0], args[1])
    return fn.apply(this, args)
  })

  //this should be always up to date...

  sbot.post(function (data) {
    follows.onAppend(data.value)
  })

  var createStream = EBTStream(
    function get (id, seq, cb) {
      sbot.getAtSequence([id, seq], function (err, data) {
        cb(null, data && data.value || data)
      })
    },
    function append (msg, cb) {
      ;(sbot.queue || sbot.add)(msg, function (err) {
        if(!err)
          follows.onAppend(msg)
//        if(err) throw err
        cb()
      })
    }
  )

  var ts = Date.now(), start = Date.now()

  function replicate (other, opts, callback) {
    if('function' === typeof opts)
      callback = opts, opts = null
    if(!opts || opts.version !== 2)
      throw new Error('expected ebt.replicate({version: 2})')

    return follows.add(other, createStream({
      onChange: Bounce(function () {
        //TODO: log progress in some way, here
        //maybe save progress to a object, per peer.
        follows.update(other)
      }, 200),
      onRequest: function (id, seq) {
        follows.onRequest(id, seq, other)
      },
      //TODO: if we switch this stream into main mode,
      //request non-send for other streams.
      onSwitch: function (id, seq) {
        //...
        console.log("SWITCH", id, seq)
      }
    },  function (err) {
      //remember their clock, so we can skip requests next time.
      follows.update(other)
      callback && callback(err)
    }))
  }

  hook(sbot.status, function (fn) {
    var _status = fn(), feeds = 0
    _status.ebt = follows.status()
    return _status
  })

  hook(sbot.progress, function (fn) {
    var prog = fn()
    var p = follows.progress()
    if(p.target) prog.ebt = p
    return prog
  })

  sbot.on('rpc:connect', function (rpc, isClient) {
    if(isClient) {
      var opts = {version: 2}
      var a = replicate(rpc.id, opts, function (err) {
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
    replicate: function (opts, cb) {
      return replicate(this.id, opts, cb)
    },
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

