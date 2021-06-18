const path = require('path')
const pull = require('pull-stream')
const toPull = require('push-stream-to-pull-stream')
const EBT = require('epidemic-broadcast-trees')
const isFeed = require('ssb-ref').isFeed
const Store = require('lossy-store')
const toUrlFriendly = require('base64-url').escape
const getSeverity = require('ssb-network-errors')

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

  // TODO: remove this when no one uses ssb-db anymore, because
  // sbot.progress is defined in ssb-db but not in ssb-db2
  if (sbot.progress) {
    hook(sbot.progress, function (fn) {
      const _progress = fn()
      const ebtProg = ebt.progress()
      if (ebtProg.target) _progress.ebt = ebtProg
      return _progress
    })
  }

  sbot.on('rpc:connect', function (rpc, isClient) {
    if (isClient) {
      const opts = { version: 3 }
      const local = toPull.duplex(ebt.createStream(rpc.id, opts.version, true))
      const remote = rpc.ebt.replicate(opts, (networkError) => {
        if (networkError && getSeverity(networkError) >= 3) {
          console.error(networkError)
        }
      })
      pull(local, remote, local)
    }
  })

  function request(destFeedId, requesting) {
    if (!isFeed(destFeedId)) return
    ebt.request(destFeedId, requesting)
  }

  function block(origFeedId, destFeedId, blocking) {
    if (!isFeed(origFeedId)) return
    if (!isFeed(destFeedId)) return
    if (blocking) {
      ebt.block(origFeedId, destFeedId, true)
    } else if (
      ebt.state.blocks[origFeedId] &&
      ebt.state.blocks[origFeedId][destFeedId]
    ) {
      // only update unblock if they were already blocked
      ebt.block(origFeedId, destFeedId, false)
    }
  }

  function replicate(opts) {
    if (opts.version !== 2 && opts.version !== 3) {
      throw new Error('expected ebt.replicate({version: 3 or 2})')
    }
    return toPull.duplex(ebt.createStream(this.id, opts.version, false))
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
    request,
    block,
    replicate,
    peerStatus,
  }
}
