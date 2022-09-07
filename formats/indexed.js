const indexed = require('../indexed-feed-format')
const ebtFormatFrom = require('./base')

module.exports = {
  ...ebtFormatFrom(indexed),

  appendMsg(sbot, msgTuple, cb) {
    const [msgVal, payload] = msgTuple
    sbot.db.add(msgVal, this.appendOpts, (err) => {
      if (err) {
        return cb(err)
      }
      sbot.db.addOOO(payload, { feedFormat: 'classic' }, (err) => {
        cb(err)
      })
    })
    // FIXME: addTransaction should support heterogenous feed formats
    // FIXME: indexed-feed-format needs to support validateBatch/BatchOOO
    // sbot.db.addTransaction([msgVal], [payload], cb)
  },

  getAtSequence(sbot, pair, cb) {
    sbot.getAtSequence([pair.id, pair.sequence], (err, msg) => {
      if (err) return cb(err)
      sbot.db.get(msg.value.content.indexed.key, (err, indexedMsgVal) => {
        if (err) return cb(err)
        cb(null, [msg.value, indexedMsgVal])
      })
    })
  },
}
