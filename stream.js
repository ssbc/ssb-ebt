'use strict'
function countKeys (o) {
  var n = 0
  for(var k in o) n++
  return n
}


var shouldReplicate = require('./follows').shouldReplicate

module.exports = function (createStream, clock, following, store, status) {
  return function replicate (other,opts, callback) {
    if('function' === typeof opts) callback = opts, opts = null
    if(!opts || opts.version !== 2) {
      throw new Error('expected ebt.replicate({version: 2})')
    }

    var stream = createStream({
      onChange: opts.onChange,
      onRequest: function (id, seq) {
        //incase this is one we skipped, but the remote has an update
        stream.request(id, following[id] ? clock.value[id]|0 : -1)
      }
    }, callback)

    store.ensure(other, function () {
      var _clock = store.get(other)
      status[other].req =
        shouldReplicate(following, _clock, clock.value, stream.request)
      stream.next()
    })

    return stream
  }
}




