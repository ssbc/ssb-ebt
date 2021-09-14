const classic = require('./classic')

module.exports = Object.assign(
  {}, classic, {
    appendMsg(sbot, msgVal, cb) {
      sbot.db.addOOO(msgVal, (err, msg) => {
        if (err) return cb(err)
        else cb(null, msg)
      })
    }
  }
)
