const ref = require('ssb-ref')

module.exports = {
  name: 'classic',
  // used in request, block, cleanClock, sbot.post, vectorClock
  isFeed(sbot, feedId) {
    return ref.isFeed(feedId)
  },
  getAtSequence(sbot, pair, cb) {
    sbot.getAtSequence([pair.id, pair.sequence], (err, msg) => {
      cb(err, msg ? msg.value : null)
    })
  },
  appendMsg(sbot, msgVal, cb) {
    sbot.add(msgVal, (err, msg) => {
      cb(err && err.fatal ? err : null, msg)
    })
  },
  // used in onAppend
  convertMsg(msgVal) {
    return msgVal
  },
  // used in vectorClock
  isReady(sbot) {
    return Promise.resolve(true)
  },

  // used in ebt:stream to distinguish between messages and notes
  isMsg(msgVal) {
    return Number.isInteger(msgVal.sequence) && msgVal.sequence > 0 &&
      ref.isFeed(msgVal.author) && msgVal.content
  },
  // used in ebt:events
  getMsgAuthor(msgVal) {
    return msgVal.author
  },
  // used in ebt:events
  getMsgSequence(msgVal) {
    return msgVal.sequence
  }
}
