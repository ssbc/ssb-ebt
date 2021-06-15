const path = require('path')
const pull = require('pull-stream')
const toPull = require('push-stream-to-pull-stream')
const EBT = require('epidemic-broadcast-trees')
const isFeed = require('ssb-ref').isFeed
const Store = require('lossy-store')
const toUrlFriendly = require('base64-url').escape
const Legacy = require('./legacy')

function isObject (o) {
  return o && typeof o === 'object'
}
function hook(hookable, fn) {
  if (typeof hookable === 'function' && hookable.hook) {
    hookable.hook(fn)
  }
}

exports.name = 'ebt'

exports.version = '1.0.0'

exports.manifest = {
  replicate: 'duplex',
  request: 'sync',
  block: 'sync',
  peerStatus: 'sync',
}

exports.permissions = {
  anonymous: {
    allow: ['replicate'],
  },
}

// there was a bug that caused some peers
// to request things that weren't feeds.
// this is fixed, so just ignore anything that isn't a feed.
function cleanClock(clock) {
  for (const k in clock) {
    if (!isFeed(k)) {
      delete clock[k]
    }
  }
}

exports.init = function (sbot, config) {
  config.replicate = config.replicate || {}
  config.replicate.fallback = true

  const dir = config.path ? path.join(config.path, 'ebt') : null
  const store = Store(dir, null, toUrlFriendly)

  const ebt = EBT({
    logging: config.ebt && config.ebt.logging,
    id: sbot.id,
    getClock(id, cb) {
      store.ensure(id, function () {
        const clock = store.get(id) || {}
        cleanClock(clock)
        cb(null, clock)
      })
    },
    setClock(id, clock) {
      cleanClock(clock, 'non-feed key when saving clock')
      store.set(id, clock)
    },
    getAt(pair, cb) {
      sbot.getAtSequence([pair.id, pair.sequence], (err, data) => {
        cb(err, data ? data.value : null)
      })
    },
    append(msg, cb) {
      sbot.add(msg, (err, msg) => {
        cb(err && err.fatal ? err : null, msg)
      })
    },
    isFeed: isFeed,
  })

  sbot.getVectorClock((err, clock) => {
    if (err) console.warn(err)
    ebt.state.clock = clock || {}
    ebt.update()
  })

  sbot.post((msg) => {
    ebt.onAppend(msg.value)
  })

  // HACK: patch calls to replicate.request into ebt, too.
  hook(sbot.replicate.request, function (fn, args) {
    let id, replicate
    if (isObject(args[0])) {
      id = args[0].id
      replicate = args[0].replicate
    } else {
      id = args[0]
      replicate = args[1]
    }
    if (!isFeed(id)) return
    ebt.request(id, replicate)
    return fn.apply(this, args)
  })

  //  hook(sbot.status, function (fn) {
  //    var _status = fn(), feeds = 0
  //    _status.ebt = ebt.status()
  //    return _status
  //  })

  hook(sbot.progress, function (fn) {
    const prog = fn()
    const p = ebt.progress()
    if (p.target) prog.ebt = p
    return prog
  })

  function onClose () {
    // TODO: delete this, it seems to be used only in tests
    sbot.emit('replicate:finish', ebt.state.clock)
  }

  sbot.on('rpc:connect', function (rpc, isClient) {
    if (isClient) {
      const opts = { version: 3 }
      const a = toPull.duplex(ebt.createStream(rpc.id, opts.version, true))
      const b = rpc.ebt.replicate(opts, function (err) {
        if (err) {
          rpc.removeListener('closed', onClose)
          rpc._emit('fallback:replicate', err)
        }
      })

      pull(a, b, a)
      rpc.on('closed', onClose)
    }
  })

  function block (from, to, blocking) {
    if (isObject(from)) {
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
    // if we blocked them, but happen to be connected, disconnect immediately.
    if (blocking && sbot.id === from && ebt.state.peers[to]) {
      // TODO: conn.disconnect might not work because we're passing a Feed ID
      // while it expects a multiserver address
      if (sbot.conn) sbot.conn.disconnect(to, function () {})
      else if (sbot.gossip) sbot.gossip.disconnect(to, function () {})
    }
  }

  if (sbot.replicate.block) {
    sbot.replicate.block.hook(function (fn, args) {
      block.apply(this, args)
      return fn.apply(this, args)
    })
  } else {
    // remove this on next breaking change
    Legacy(sbot, ebt)
  }

  function replicate(opts) {
    if (opts.version !== 2 && opts.version !== 3) {
      throw new Error('expected ebt.replicate({version: 3 or 2})')
    }
    return toPull.duplex(ebt.createStream(sbot.id, opts.version, false))
  }

  // get replication status for feeds for this id.
  function peerStatus(id) {
    id = id || sbot.id
    const data = {
      id: id,
      seq: ebt.state.clock[id],
      peers: {},
    }
    for (const k in ebt.state.peers) {
      const peer = ebt.state.peers[k]
      if (peer.clock[id] != null || peer.replicating[id] != null) {
        const rep = peer.replicating && peer.replicating[id]
        data.peers[k] = {
          seq: peer.clock[id],
          replicating: rep,
        }
      }
    }
    return data
  }

  return {
    replicate,
    peerStatus,
    block,
  }
}
