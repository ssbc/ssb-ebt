const SSBURI = require('ssb-uri2')
const butt2 = require('ssb-buttwoo')
const bfe = require('ssb-bfe')

module.exports = {
  name: 'buttwoo-v1',
  prepareForIsFeed(sbot, feedId, cb) {
    cb()
  },
  // used in request, block, cleanClock, sbot.post, vectorClock
  isFeed (sbot, feedId) {
    // FIXME: this needs to handle parent!
    return SSBURI.isButtwooV1FeedSSBURI(feedId)
  },
  getAtSequence (sbot, pair, cb) {
    sbot.getAtSequenceNativeMsg([pair.id, pair.sequence], (err, nativeMsg) => {
      if (err) cb(err)
      else cb(null, nativeMsg) //butt2.bipfToButt2(buf))
    })
  },
  appendMsg (sbot, buffer, cb) {
    sbot.db.add(buffer, { encoding: 'bipf', feedFormat: 'buttwoo-v1' }, (err) => {
      cb(err && err.fatal ? err : null)
    })
  },
  // not used
  convertMsg (sbot, msgVal, cb) {},
  // used in vectorClock
  isReady (sbot) {
    return Promise.resolve(true)
  },

  // used in ebt:stream to distinguish between messages and notes
  isMsg (bufferOrMsgVal) {
    return Buffer.isBuffer(bufferOrMsgVal)
  },
  // used in ebt:events
  getMsgAuthor (bufferOrMsgVal) {
    if (Buffer.isBuffer(bufferOrMsgVal)) {
      const author = bfe.decode(butt2.extractAuthor(bufferOrMsgVal))
      const parent = bfe.decode(butt2.extractParent(bufferOrMsgVal))
      return author + (parent === null ? '' : parent)
    } else {
      return bufferOrMsgVal.author + (bufferOrMsgVal.parent === null ? '' : bufferOrMsgVal.parent)
    }
  },
  // used in ebt:events
  getMsgSequence (bufferOrMsgVal) {
    if (Buffer.isBuffer(bufferOrMsgVal)) {
      return bfe.decode(butt2.extractSequence(bufferOrMsgVal))
    } else {
      return bufferOrMsgVal.sequence
    }
  }
}
