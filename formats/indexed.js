const classic = require('./classic')
const pify = require('promisify-4loc')
const { QL0 } = require('ssb-subset-ql')

module.exports = {
  ...classic,
  name: 'indexed',
  prepareForIsFeed(sbot, feedId, cb) {
    sbot.metafeeds.ensureLoaded(feedId, cb)
  },
  isFeed (sbot, author) {
    const info = sbot.metafeeds.findByIdSync(author)
    return info && info.feedpurpose === 'index'
  },
  appendMsg (sbot, msgVal, cb) {
    const payload = msgVal.content.indexed.payload
    delete msgVal.content.indexed.payload
    sbot.db.addTransaction([msgVal], [payload], cb)
  },
  getAtSequence (sbot, pair, cb) {
    sbot.getAtSequence([pair.id, pair.sequence], (err, msg) => {
      if (err) return cb(err)

      module.exports.convertMsg(sbot, msg.value, cb)
    })
  },
  convertMsg (sbot, msgVal, cb) {
    const { sequence } = msgVal.content.indexed
    const authorInfo = sbot.metafeeds.findByIdSync(msgVal.author)
    if (!authorInfo) return cb(new Error('Unknown author:' + msgVal.author))
    const { author } = QL0.parse(authorInfo.metadata.query)
    sbot.getAtSequence([author, sequence], (err, indexedMsg) => {
      if (err) return cb(err)

      // add referenced message as payload
      const msgValWithPayload = { ...msgVal }
      msgValWithPayload.content = { ...msgValWithPayload.content }
      msgValWithPayload.content.indexed = {
        ...msgValWithPayload.content.indexed,
        payload: indexedMsg.value
      }

      cb(null, msgValWithPayload)
    })
  },
  isReady (sbot) {
    return pify(sbot.metafeeds.loadState)()
  }
}
