const SSBURI = require('ssb-uri2')
const bendyButt = require('ssb-bendy-butt')

module.exports = {
  name: 'bendybutt-v1',
  // used in request, block, cleanClock, sbot.post, vectorClock
  sbotIsFeed(sbot, feedId) {
    return SSBURI.isBendyButtV1FeedSSBURI(feedId)
  },
  getAtSequence(sbot, pair, cb) {
    sbot.getAtSequence([pair.id, pair.sequence], (err, msg) => {
      cb(err, msg ? bendyButt.encode(msg.value) : null)
    })
  },
  appendMsg(sbot, msgVal, cb) {
    sbot.add(bendyButt.decode(msgVal), (err, msg) => {
      cb(err && err.fatal ? err : null, msg)
    })
  },
  convertMsg(msgVal) {
    return bendyButt.encode(msgVal)
  },
  // used in vectorClock
  isReady(sbot) {
    return Promise.resolve(true)
  },

  // used in ebt:stream to distinguish between messages and notes
  isMsg(bbVal) {
    if (Buffer.isBuffer(bbVal)) {
      const msgVal = bendyButt.decode(bbVal)
      return msgVal && SSBURI.isBendyButtV1FeedSSBURI(msgVal.author)
    } else {
      return bbVal && SSBURI.isBendyButtV1FeedSSBURI(bbVal.author)
    }
  },
  // used in ebt:events
  getMsgAuthor(bbVal) {
    if (Buffer.isBuffer(bbVal))
      return bendyButt.decode(bbVal).author
    else
      return bbVal.author
  },
  // used in ebt:events
  getMsgSequence(bbVal) {
    if (Buffer.isBuffer(bbVal))
      return bendyButt.decode(bbVal).sequence
    else
      return bbVal.sequence
  }
}
