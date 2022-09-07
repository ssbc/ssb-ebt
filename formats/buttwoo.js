const ebtFormatFrom = require('./base')
const buttwoo = require('ssb-buttwoo/format')

module.exports = {
  ...ebtFormatFrom(buttwoo),

  appendOpts: { encoding: 'bipf', feedFormat: buttwoo.name },

  // Optimization
  isMsg(bufferOrMsgVal) {
    return Buffer.isBuffer(bufferOrMsgVal)
  },
}
