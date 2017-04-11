var pull = require('pull-stream')

require('ssb-client')(function (err, sbot) {
  var n = 0, ts = Date.now(), start = Date.now()
  pull(
    sbot.ebt._dump(),
    pull.drain(function (msg) {
      var _ts
      n++
      if((_ts = Date.now()) > ts+1000) {
        console.log(n, n / ((Date.now() - start)/1000))
        ts = _ts
      }
    }, sbot.close)
  )
})

