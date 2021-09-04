const path = require('path')
const pull = require('pull-stream')
const toPull = require('push-stream-to-pull-stream')
const EBT = require('epidemic-broadcast-trees')
const ref = require('ssb-ref')
const Store = require('lossy-store')
const toUrlFriendly = require('base64-url').escape
const getSeverity = require('ssb-network-errors')
const DeferredPromise = require('p-defer')
const pullDefer = require('pull-defer')

function hook (hookable, fn) {
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
  getClock: 'async'
}

exports.permissions = {
  anonymous: {
    allow: ['replicate']
  }
}

// there was a bug that caused some peers
// to request things that weren't feeds.
// this is fixed, so just ignore anything that isn't a feed.
function cleanClock (clock, isFeed) {
  for (const k in clock) {
    if (!isFeed(k)) {
      delete clock[k]
    }
  }
}

exports.init = function (sbot, config) {
  const formats = {
    'classic': {
      isMsg(m) {
        return Number.isInteger(m.sequence) && m.sequence > 0 &&
          typeof m.author == 'string' && m.content
      },
      isFeed: ref.isFeed,
      getMsgAuthor(msg) {
        return msg.author
      },
      getMsgSequence(msg) {
        return msg.sequence
      }
    }
  }

  const ebts = {}
  function addEBT(formatName) {
    const dirName = 'ebt' + (formatName === 'classic') ? '' : formatName
    const dir = config.path ? path.join(config.path, dirName) : null
    const store = Store(dir, null, toUrlFriendly)

    const isFeed = formats[formatName].isFeed

    const ebt = EBT(Object.assign({
      logging: config.ebt && config.ebt.logging,
      id: sbot.id,
      getClock (id, cb) {
        store.ensure(id, function () {
          const clock = store.get(id) || {}
          cleanClock(clock, isFeed)
          cb(null, clock)
        })
      },
      setClock (id, clock) {
        cleanClock(clock, isFeed)
        store.set(id, clock)
      },
      getAt (pair, cb) {
        sbot.getAtSequence([pair.id, pair.sequence], (err, data) => {
          cb(err, data ? data.value : null)
        })
      },
      append (msg, cb) {
        sbot.add(msg, (err, msg) => {
          cb(err && err.fatal ? err : null, msg)
        })
      }
    }, formats[formatName]))

    ebts[formatName] = ebt
  }

  function getEBT(formatName) {
    const ebt = ebts[formatName]
    if (!ebt)
      throw new Error('Unknown format' + formatName)

    return ebt
  }

  addEBT('classic')

  const initialized = DeferredPromise()

  sbot.getVectorClock((err, clock) => {
    if (err) console.warn('Failed to getVectorClock in ssb-ebt because:', err)
    for (let format in ebts) {
      const ebt = ebts[format]
      // FIXME: do we need to split the clock?
      ebt.state.clock = clock || {}
      ebt.update()
    }
    initialized.resolve()
  })

  sbot.post((msg) => {
    initialized.promise.then(() => {
      for (let format in ebts) {
        if (formats[format].isMsg(msg.value))
          ebts[format].onAppend(msg.value)
      }
    })
  })

  // TODO: remove this when no one uses ssb-db anymore, because
  // sbot.progress is defined in ssb-db but not in ssb-db2
  if (sbot.progress) {
    hook(sbot.progress, function (fn) {
      const _progress = fn()
      const ebt = ebts['classic']
      const ebtProg = ebt.progress()
      if (ebtProg.target) _progress.ebt = ebtProg
      return _progress
    })
  }

  sbot.on('rpc:connect', function (rpc, isClient) {
    if (rpc.id === sbot.id) return // ssb-client connecting to ssb-server
    if (isClient) {
      initialized.promise.then(() => {
        for (let format in ebts) {
          const ebt = ebts[format]
          const opts = { version: 3, format }
          const local = toPull.duplex(ebt.createStream(rpc.id, opts.version, true))
          const remote = rpc.ebt.replicate(opts, (networkError) => {
            if (networkError && getSeverity(networkError) >= 3) {
              console.error('rpc.ebt.replicate exception:', networkError)
            }
          })
          pull(local, remote, local)
        }
      })
    }
  })

  function request(destFeedId, requesting, formatName) {
    initialized.promise.then(() => {
      formatName = formatName || 'classic'
      const format = formats[formatName]

      if (!(format && format.isFeed(destFeedId))) return
      
      ebts[formatName].request(destFeedId, requesting)
    })
  }

  function block(origFeedId, destFeedId, blocking, formatName) {
    initialized.promise.then(() => {
      formatName = formatName || 'classic'
      const format = formats[formatName]

      if (!format) return
      if (!format.isFeed(origFeedId)) return
      if (!format.isFeed(destFeedId)) return

      const ebt = ebts[formatName]

      if (blocking) {
        ebt.block(origFeedId, destFeedId, true)
      } else if (
        ebt.state.blocks[origFeedId] &&
          ebt.state.blocks[origFeedId][destFeedId]
      ) {
        // only update unblock if they were already blocked
        ebt.block(origFeedId, destFeedId, false)
      }
    })
  }

  function replicate (opts) {
    if (opts.version !== 3) {
      throw new Error('expected ebt.replicate({version: 3})')
    }

    let formatName = opts.format || 'classic'
    const ebt = getEBT(formatName)

    var deferred = pullDefer.duplex()
    initialized.promise.then(() => {
      // `this` refers to the remote peer who called this muxrpc API
      deferred.resolve(toPull.duplex(ebt.createStream(this.id, opts.version, false)))
    })
    return deferred
  }

  // get replication status for feeds for this id
  function peerStatus(id, formatName) {
    id = id || sbot.id
    formatName = formatName || 'classic'
    const ebt = getEBT(formatName)

    const data = {
      id: id,
      seq: ebt.state.clock[id],
      peers: {}
    }

    for (const k in ebt.state.peers) {
      const peer = ebt.state.peers[k]
      if (peer.clock[id] != null ||
          (peer.replicating && peer.replicating[id] != null)) {
        const rep = peer.replicating && peer.replicating[id]
        data.peers[k] = {
          seq: peer.clock[id],
          replicating: rep
        }
      }
    }

    return data
  }

  function clock(formatName, cb) {
    if (!cb) {
      cb = formatName
      formatName = 'classic'
    }

    initialized.promise.then(() => {
      const ebt = getEBT(formatName)
      cb(null, ebt.state.clock)
    })
  }

  function registerFormat(formatName, methods) {
    formats[formatName] = methods
    addEBT(formatName)
  }

  return {
    request,
    block,
    replicate,
    peerStatus,
    clock,
    registerFormat
  }
}
