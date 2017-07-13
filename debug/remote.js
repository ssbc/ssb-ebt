var pull = require('pull-stream')
var EBT = require('epidemic-broadcast-trees')
var v = require('ssb-validate')
var Bounce = require('epidemic-broadcast-trees/bounce')
function createStream (onDone, cb) {
  var state = {
    queue: {push: function () {} }, //fake array
    feeds: {},
    error: null
  }
  console.log('messages/second, messages total, time elapsed')
  var ts = Date.now(), start = Date.now(), count = 0, _count = 0
  var stream
  var createStream = EBT(
    function get (id, seq, cb) {
      //should never be called...
      throw new Error('not expecting to ever send anything')
    },
    function append (msg, cb) {
      stream.onAppend(msg)
      cb()
    }
  )
  return stream = createStream({
      onChange: Bounce(function () {
//        var p = stream.progress()
//        console.log(p, stream.meta)
//        if(p.current === p.target)
//          onDone(p)
      }, 1000),
      onRequest: function (id, seq) {
        stream.request(id, 0)
      },
    },
    cb
  )
}

var opts = null
if(process.argv[2])
  opts = {remote: process.argv[2]}

require('ssb-client')(null, opts, function (err, sbot) {
  if(err) throw err
  var ebt = createStream(function () {
    sbot.close()
  }, function (err) {
    if(err) throw err
    sbot.close()
  })

  var int = setInterval(function () {
    var p = ebt.progress()
    console.log(p, ebt.meta)
    if(p.target && p.current == p.target) {
      clearInterval(int)
      sbot.close(true)
    }
  }, 1000)

  pull(ebt, sbot.ebt.replicate({version: 2}, function (err) {
    if(err) throw err
    sbot.close()
  }), ebt)

})
