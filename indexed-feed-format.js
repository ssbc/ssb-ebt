const ssbKeys = require('ssb-keys')
const classic = require('ssb-classic/format')
const { isIndexedV1FeedSSBURI } = require('ssb-uri2')

module.exports = {
  name: 'indexed-v1',
  encodings: ['js'],

  isAuthor(feedId) {
    return typeof feedId === 'string' && isIndexedV1FeedSSBURI(feedId)
  },

  isNativeMsg(msgTuple) {
    if (Array.isArray(msgTuple) && msgTuple.length === 2) {
      const [msgVal, payload] = msgTuple
      return (
        isIndexedV1FeedSSBURI(msgVal.author) && classic.isNativeMsg(payload)
      )
    } else return isIndexedV1FeedSSBURI(msgTuple.author)
  },

  getFeedId(msgTuple) {
    const msgVal = Array.isArray(msgTuple) ? msgTuple[0] : msgTuple
    return msgVal.author
  },

  getSequence(msgTuple) {
    const msgVal = Array.isArray(msgTuple) ? msgTuple[0] : msgTuple
    return msgVal.sequence
  },

  getMsgId(msgTuple) {
    const msgVal = Array.isArray(msgTuple) ? msgTuple[0] : msgTuple
    const hash = ssbKeys.hash(JSON.stringify(msgVal, null, 2))
    return `ssb:message/indexed-v1/${hash
      .replace(/\+/g, '-')
      .replace(/\//g, '_')}`
  },

  toPlaintextBuffer(opts) {
    return Buffer.from(JSON.stringify(opts.content), 'utf8')
  },

  newNativeMsg(opts) {
    const msgVal = classic.newNativeMsg(opts)
    const payload = opts.payload || null
    return [msgVal, payload]
  },

  fromNativeMsg(msgTuple, encoding = 'js') {
    if (encoding === 'js') {
      return Array.isArray(msgTuple) ? msgTuple[0] : msgTuple
    } else {
      // prettier-ignore
      throw new Error(`Feed format "indexed" does not support encoding "${encoding}"`)
    }
  },

  fromDecryptedNativeMsg(plaintextBuf, msgTuple, encoding = 'js') {
    if (encoding === 'js') {
      const msgVal = Array.isArray(msgTuple) ? msgTuple[0] : msgTuple
      const content = JSON.parse(plaintextBuf.toString('utf8'))
      msgVal.content = content
      return msgVal
    } else {
      // prettier-ignore
      throw new Error(`Feed format "indexed" does not support encoding "${encoding}"`)
    }
  },

  toNativeMsg(msgVal, encoding = 'js') {
    if (encoding === 'js') {
      return [msgVal, null]
    } else {
      // prettier-ignore
      throw new Error(`Feed format "indexed" does not support encoding "${encoding}"`)
    }
  },

  validate(nativeMsg, prevNativeMsg, hmacKey, cb) {
    return cb()
    // FIXME: validate based on classic algorithms
    // nativeMsg can be the tuple or the index msgVal
  },
}
