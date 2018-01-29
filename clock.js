'use strict'
var Obv = require('obv')

module.exports = function (sbot) {
  var clock
  var obv = Obv()
  sbot.getVectorClock(function (err, _clock) {
    obv.set(clock = _clock)
  })

  //messages appended in realtime.
  sbot.post(function (msg) {
    //ensure the clock object is always up to date, once loaded.
    var v = msg.value
    if(clock[v.author] == null || clock[v.author] < v.sequence)
      clock[v.author] = v.sequence
    obv.set(clock)
  })

  return obv
}

