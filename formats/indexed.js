const classic = require('./classic')
const pify = require('promisify-4loc')
const { QL0 } = require('ssb-subset-ql')

module.exports = function () {
  return {
    ...classic, 
    sbotIsFeed(sbot, author) {
      const info = sbot.metafeeds.findByIdSync(author)
      return info && info.feedpurpose === 'index'
    },
    appendMsg(sbot, msgVal, cb) {
      // FIXME: this needs the ability to add 2 messages in a transaction
      const payload = msgVal.content.indexed.payload
      delete msgVal.content.indexed.payload
      sbot.db.add(msgVal, (err, msg) => {
        if (err) return cb(err)
        sbot.db.addOOO(payload, (err, indexedMsg) => {
          if (err) return cb(err)
          else cb(null, msg)
        })
      })
    },
    getAtSequence(sbot, pair, cb) {
      sbot.getAtSequence([pair.id, pair.sequence], (err, msg) => {
        if (err) return cb(err)
        const { sequence } = msg.value.content.indexed
        const authorInfo = sbot.metafeeds.findByIdSync(msg.value.author)
        if (!authorInfo) return cb(new Error("Unknown author:" + msg.value.author))
        const { author } = QL0.parse(authorInfo.metadata.query)
        sbot.getAtSequence([author, sequence], (err, indexedMsg) => {
          if (err) return cb(err)

          // add referenced message as payload
          msg.value.content.indexed.payload = indexedMsg.value

          cb(null, msg.value)
        })
      })
    },
    isReady(sbot) {
      return pify(sbot.metafeeds.loadState)()
    }
  }
}
