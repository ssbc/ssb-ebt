const SSBURI = require('ssb-uri2')
const bendyButt = require('ssb-bendy-butt/format')

// encoding is wierd here, it is actually bencode
const appendOpts = { encoding: 'js', feedFormat: 'bendybutt-v1' }

module.exports = {
  name: 'bendybutt-v1',
  prepareForIsFeed(sbot, feedId, cb) {
    cb()
  },
  // used in request, block, cleanClock, sbot.post, vectorClock
  isFeed (sbot, feedId) {
    return SSBURI.isBendyButtV1FeedSSBURI(feedId)
  },
  getAtSequence (sbot, pair, cb) {
    sbot.getAtSequence([pair.id, pair.sequence], (err, msg) => {
      cb(err, msg ? bendyButt.toNativeMsg(msg.value) : null)
    })
  },
  appendMsg (sbot, buffer, cb) {
    sbot.db.add(buffer, appendOpts, (err, msg) => {
      cb(err && err.fatal ? err : null, msg)
    })
  },
  convertMsg (sbot, msgVal, cb) {
    cb(null, bendyButt.toNativeMsg(msgVal))
  },
  // used in vectorClock
  isReady (sbot) {
    return Promise.resolve(true)
  },

  // used in ebt:stream to distinguish between messages and notes
  isMsg (bbVal) {
    if (Buffer.isBuffer(bbVal)) {
      const msgVal = bendyButt.fromNativeMsg(bbVal)
      return msgVal && SSBURI.isBendyButtV1FeedSSBURI(msgVal.author)
    } else {
      return bbVal && SSBURI.isBendyButtV1FeedSSBURI(bbVal.author)
    }
  },
  // used in ebt:events
  getMsgAuthor (bbVal) {
    if (Buffer.isBuffer(bbVal)) { return bendyButt.fromNativeMsg(bbVal).author } else { return bbVal.author }
  },
  // used in ebt:events
  getMsgSequence (bbVal) {
    if (Buffer.isBuffer(bbVal)) { return bendyButt.fromNativeMsg(bbVal).sequence } else { return bbVal.sequence }
  }
}
