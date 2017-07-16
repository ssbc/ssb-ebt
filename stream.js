
function countKeys (o) {
  var n = 0
  for(var k in o) n++
  return n
}


module.exports = function (createStream, clock, following, store, status) {
  return function replicate (other,opts, callback) {
    if('function' === typeof opts) callback = opts, opts = null
    if(!opts || opts.version !== 2) {
      throw new Error('expected ebt.replicate({version: 2})')
    }

//    status[other] = {}

    var stream = createStream({
      onChange: opts.onChange,
      onRequest: function (id, seq) {
        //incase this is one we skipped, but the remote has an update

        if(following[id])
          stream.request(id, clock[id]|0)
        else
          stream.request(id, -1)

      }
    }, callback)

    store.ensure(other, function () {
      var _clock = store.get(other)

      var req = status[other].req = {
        total:countKeys(following),
        common: 0,
        requested: 0
      }

      if(_clock) {
        for(var k in _clock) {
          if(following[k])
            req.common++
          else
            req.total++
        }
      }

      for(var k in following) {
        if(following[k] == true) {
          if(!_clock || !(_clock[k] == -1 || _clock[k] == (clock[k] || 0))) {
            req.requested ++
            stream.request(k, clock[k] || 0, false)
          }
        }
      }
      stream.next()
    })

    return stream
  }
}

