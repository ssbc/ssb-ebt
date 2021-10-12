const pify = require('promisify-4loc')
const ref = require('ssb-ref')
const { QL0 } = require('ssb-subset-ql')

module.exports = {
  name: 'indexed',
  prepareForIsFeed(sbot, feedId, cb) {
    sbot.metafeeds.ensureLoaded(feedId, cb)
  },
  isFeed (sbot, author) {
    const info = sbot.metafeeds.findByIdSync(author)
    return info && info.feedpurpose === 'index'
  },
  appendMsg (sbot, msgTuple, cb) {
    const [msgVal, payload] = msgTuple
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

      cb(null, [msgVal, indexedMsg.value])
    })
  },
  isReady (sbot) {
    return pify(sbot.metafeeds.loadState)()
  },
  isMsg (msgTuple) {
    if (Array.isArray(msgTuple) && msgTuple.length === 2) {
      const [msgVal, payload] = msgTuple
      return Number.isInteger(msgVal.sequence) && msgVal.sequence > 0 &&
        ref.isFeed(msgVal.author) && msgVal.content
    } else
      return false
  },
  getMsgAuthor (msgTuple) {
    return msgTuple[0].author
  },
  getMsgSequence (msgTuple) {
    return msgTuple[0].sequence
  }
}
