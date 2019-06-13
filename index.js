'use strict'
var pull = require('pull-stream')
var EBT = require('epidemic-broadcast-trees')
var path = require('path')
var toPull = require('push-stream-to-pull-stream')
var isFeed = require('ssb-ref').isFeed
var Legacy = require('./legacy')

var Store = require('lossy-store')
var toUrlFriendly = require('base64-url').escape

function isEmpty (o) {
  for(var k in o) return false
  return true
}

function isObject (o) {
  return o && 'object' == typeof o
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
  request: 'sync',
  block: 'sync',
  peerStatus: 'sync'
}
exports.permissions = {
  anonymous: {allow: ['replicate']},
}

//there was a bug that caused some peers
//to request things that weren't feeds.
//this is fixed, so just ignore anything that isn't a feed.
function cleanClock (clock, message) {
  for(var k in clock)
    if(!isFeed(k)) {
      delete clock[k]
    }
}

exports.init = function (sbot, config) {
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
        cleanClock(clock)
        cb(null, clock)
      })
    },
    setClock: function (id, clock) {
      cleanClock(clock, 'non-feed key when saving clock')
      store.set(id, clock)
    },
    getAt: function (pair, cb) {
      sbot.getAtSequence([pair.id, pair.sequence], function (err, data) {
        cb(err, data ? data.value : null)
      })
    },
    append: function (msg, cb) {
      sbot.add(msg, function (err, msg) {
        cb(err && err.fatal ? err : null, msg)
      })
    },
    isFeed: isFeed,
  })

  sbot.getVectorClock(function (err, clock) {
    ebt.state.clock = clock || {}
    ebt.update()
  })

  sbot.post(function (msg) {
    ebt.onAppend(msg.value)
  })

  var status = {}

  //HACK: patch calls to replicate.request into ebt, too.
  hook(sbot.replicate.request, function (fn, args) {
    var id, replicate
    if(isObject(args[0])) {
      id = args[0].id
      replicate = args[0].replicate
    }
    else {
      id = args[0]
      replicate = args[1]
    }
    if(!isFeed(id)) return
    ebt.request(id, replicate)
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

  function onClose () {
    sbot.emit('replicate:finish', ebt.state.clock)
  }


  sbot.on('rpc:connect', function (rpc, isClient) {
    if(isClient) {
      var opts = {version: 3}
      var a = toPull.duplex(ebt.createStream(rpc.id, opts.version, true))
      var b = rpc.ebt.replicate(opts, function (err) {
        if(err) {
          rpc.removeListener('closed', onClose)
          rpc._emit('fallback:replicate', err)
        }
      })

      pull(a, b, a)
      rpc.on('closed', onClose)
    }
  })

  function block (from, to, blocking) {
    if(isObject(from)) {
      to = from.to
      blocking = from.blocking
      from = from.from
    }
    if (blocking) {
      ebt.block(from, to, true)
    } else if (ebt.state.blocks[from] && ebt.state.blocks[from][to]) {
      // only update unblock if they were already blocked
      ebt.block(from, to, false)
    }
  }

  if(sbot.replicate.block)
    sbot.replicate.block.hook(function (fn, args) {
      block.apply(this, args)
      return fn.apply(this, args)
    })
  else
    Legacy(sbot, ebt) //remove this on next breaking change

  return {
    replicate: function (opts) {
      if(opts.version !== 2 && opts.version != 3)
        throw new Error('expected ebt.replicate({version: 3 or 2})')
      return toPull.duplex(ebt.createStream(this.id, opts.version, false))
    },
    //get replication status for feeds for this id.
    peerStatus: function (id) {
      id = id || sbot.id
      var data = {
        id: id,
        seq: ebt.state.clock[id],
        peers: {},
      }
      for(var k in ebt.state.peers) {
        var peer = ebt.state.peers[k]
        if(peer.clock[id] != null || peer.replicating[id] != null) {
          var rep = peer.replicating && peer.replicating[id]
          data.peers[k] = {
            seq: peer.clock[id],
            replicating: rep
          }
        }
      }
      return data
    },

    // expose ebt.block for ssb-servers that don't have the ssb-friends plugin
    block: block
  }
}
