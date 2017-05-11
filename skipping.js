var Store = require('lossy-store')

module.exports = function (sbot) {

  return {
    request: function (id, seq) {
      seq = seq | 0
      //on any active streams, start following.
      for(var k in streams)
        streams[k].request(id, seq)
    },
    replicateWith: function (id, createStream) {
      //if we have a clock for id, ensure it is loaded.
      //this calls back immediately if we have already
      //replicated with id since the process started.
      store.ensure(id, function () {
        streams[id] = createStream(function (err) {{
          var _clock = store.get(id)
          for(var k in stream.state)
            if(stream.state[k].remote.req != null)
              _clock[k] = stream.state[k].remote.req

          store.set(id, _clock)
        })

        var _clock = store.get(id)

        getVectorClock(function (err, clock) {
          for(var k in clock) {
            if(!_clock || _clock[k] != clock[k])
              stream.request(k, clock[k])
          }
        })
      }
    }
  }
}

