var pull = require('pull-stream')
var EBT = require('epidemic-broadcast-trees')
var v = require('ssb-validate')

function createStream (cb) {
  var state = {
    queue: {push: function () {} }, //fake array
    feeds: {},
    error: null
  }
  console.log('messages/second, messages total, time elapsed')
  var ts = Date.now(), start = Date.now(), count = 0, _count = 0
  var s
  return s = EBT(
    {}, //empty, because we'll just replicate everything
    function (id, seq, cb) {
      throw new Error('we expect only to pull, in this example')
    },
    function (msg, cb) {
      state = v.append(state, msg)
      if(state.error) throw state.error

      count ++
      if(Date.now() > ts + 1000) {
        console.log([count - _count, _count = count, ((ts = Date.now()) - start)].join(', '))
      }
      s.onAppend(msg)
      cb()
    },
    function () {
    },
    function (err) {
      cb(err)
    }
  )
}

var opts = null
if(process.argv[2])
  opts = {remote: process.argv[2]}

require('ssb-client')(null, opts, function (err, sbot) {
  if(err) throw err
  var ebt = createStream(function (err) {
    if(err) throw err
    sbot.close()
  })

  pull(ebt, sbot.ebt.replicate(function (err) {
    if(err) throw err
    sbot.close()
  }), ebt)

})












