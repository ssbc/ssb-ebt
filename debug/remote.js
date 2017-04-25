var pull = require('pull-stream')
var EBT = require('epidemic-broadcast-trees')
var v = require('ssb-validate')

function createStream (cb) {
  var state = {
    queue: {push: function () {} }, //fake array
    feeds: {},
    error: null
  }

  var _ts = Date.now(), start = Date.now(), _recv
  var s
  return s = EBT(
    {}, //empty, because we'll just replicate everything
    function (id, seq, cb) {
      throw new Error('we expect only to pull, in this example')
    },
    function (msg, cb) {
      state = v.append(state, msg)
      if(state.error) throw state.error
      s.onAppend(msg)
      cb()
    },
    function (progress) {
      var ts = Date.now()
      if(_ts + 1000 < ts) {
        console.log(progress.recv, _recv -  progress.recv, progress.recv / ((Date.now() - start) / 1000))
        _ts = ts
        _recv = progress.recv
      }
    },
    function (err) {
      console.log((Date.now() - start)/1000)
      cb(err)
    }
  )
}

require('ssb-client')(function (err, sbot) {
  var ebt = createStream(function (err) {
    if(err) throw err
    sbot.close()
  })

  pull(ebt, sbot.ebt.replicate(function (err) {
    if(err) throw err
    sbot.close()
  }), ebt)

})



