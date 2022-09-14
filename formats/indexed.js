const indexed = require('ssb-index-feed-writer/format')
const ebtFormatFrom = require('./base')

module.exports = {
  ...ebtFormatFrom(indexed),

  appendMsg(sbot, msgTuple, cb) {
    if (Array.isArray(msgTuple) && msgTuple.length === 2) {
      const [msgVal, payload] = msgTuple
      sbot.db.addTransaction([msgVal], [payload], cb)
    } else {
      cb(new Error('Invalid index feed message tuple received by ssb-ebt'))
    }
  },

  getAtSequence(sbot, pair, cb) {
    sbot.getAtSequence([pair.id, pair.sequence], (err, indexMsg) => {
      if (err) return cb(err)
      sbot.db.get(indexMsg.value.content.indexed, (err, payload) => {
        if (err) return cb(err)
        cb(null, [indexMsg.value, payload])
      })
    })
  },
}
