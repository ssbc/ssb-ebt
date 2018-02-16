'use strict'
var Obv = require('obv')
var pull = require('pull-stream')
//var pContDuplex = require('pull-cont/duplex')
var EBT = require('epidemic-broadcast-trees')
var path = require('path')
var toPull = require('push-stream-to-pull-stream')

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

  var dir = config.path ? path.join(config.path, 'ebt') : null
  var store = Store(dir, null, toUrlFriendly)

  var ebt = EBT({
    logging: config.ebt && config.ebt.logging,
    id: sbot.id,
    getClock: function (id, cb) {
      store.ensure(id, function () {
        var clock = store.get(id) || {}
        cb(null, clock)
      })
    },
    setClock: function (id, clock) {
      store.set(id, clock)
    },
    getAt: function (pair, cb) {
      sbot.getAtSequence([pair.id, pair.sequence], function (err, data) {
        cb(err, data ? data.value : null)
      })
    },
    append: function (msg, cb) {
      sbot.add(msg, cb)
    },
  })

//  setInterval(function () {
//    for(var id in ebt.state.peers) {
//      if(ebt.state.peers[id].clock) {
//        store.set(id, ebt.state.peers[id].clock)
//      }
//    }
//  }, 10000).unref()

  sbot.getVectorClock(function (err, clock) {
    ebt.state.clock = clock
    ebt.update()
  })

  sbot.post(function (msg) {
    ebt.onAppend(msg.value)
  })

  var status = {}

  //HACK: patch calls to replicate.request into ebt, too.
  hook(sbot.replicate.request, function (fn, args) {
    ebt.request(args[0], args[1])
    return fn.apply(this, args)
  })

  var ts = Date.now(), start = Date.now()

//  hook(sbot.status, function (fn) {
//    var _status = fn(), feeds = 0
//    _status.ebt = ebt.status()
//    return _status
//  })
//
  hook(sbot.progress, function (fn) {
    var prog = fn()
    var p = ebt.progress()
    if(p.target) prog.ebt = p
    return prog
  })

  sbot.on('rpc:connect', function (rpc, isClient) {
    if(isClient) {
      var opts = {version: 2}
      var a = toPull.duplex(ebt.createStream(rpc.id))
      var b = rpc.ebt.replicate(opts, function (err) {
        rpc._emit('fallback:replicate', err)
      })

      pull(a, b, a)
    }
  })

  return {
    replicate: function (opts) {
      if(opts.version !== 2)
        throw new Error('expected ebt.replicate({version: 2})')
      return toPull.duplex(ebt.createStream(this.id))
    },
    _state: function () {
      return ebt.state
    },
    _dump: require('./debug/local')(sbot) //just for performance testing. not public api
  }
}

