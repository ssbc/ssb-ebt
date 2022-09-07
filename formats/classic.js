const ebtFormatFrom = require('./base')
const classic = require('ssb-classic/format')

module.exports = {
  ...ebtFormatFrom(classic),

  isMsg(msgVal) {
    return (
      classic.isNativeMsg(msgVal) &&
      Number.isInteger(msgVal.sequence) &&
      msgVal.sequence > 0 &&
      msgVal.content
    )
  },
}
