'use strict'

var Store = require('lossy-store')
var toUrlFriendly = require('base64-url').escape

/*
This manages the state across multiple ebt streams,
the lossy-store instance that remote clocks are stored in.
it smells a lot like a Java SomethingManager class.

I kinda want to rewrite it in a functional state based style
like I did for the main epidemic-broadcast-trees module,
but that code is harder to write (but way easier to test)
but possibly there is something that I just havn't figured out about that yet.

*/

function isEmpty (o) {
  for(var k in o) return false
  return true
}

function countKeys (o) {
  var n = 0
  for(var k in o) n++
  return n
}

function progressReduce (acc, item) {
  if(isNaN(item.start)) throw new Error('must not be NaN')
  acc.start += item.start
  acc.current += item.current
  acc.target += item.target
  return acc
}

function isFollowing (state) {
  return (
      state == null ? false
    : state.local.req == null ? false
    : state.local.req !== -1
  )
}

//ops, is called when any stream is connected and it
//iterates over every stream!
function shouldReplicate (following, _clock, clock, request) {

  var req = {
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
      //i think there is a bug here - if remote didn't have it
      //(they just wanted it) but previously we said we didn't want
      //it, but now we do... only happens the feed has no messages though)
      if(!_clock || !(_clock[k] == -1 || _clock[k] == (clock[k] || 0))) {
        req.requested ++
        request(k, clock[k] || 0, false)
      }
    }
  }

  return req
}

module.exports = function (store, clock, status) {
//  var store = Store(dir,
//    null, toUrlFriendly
//  )


  var following = {}, streams = {}, self

  function request (id, state) {
    state = state !== false //true unless explicitly false
    if(following[id] === state) return
    following[id] = state
    //start all current streams following this one.
    var first = true
    for(var k in streams) {
      if(state !== isFollowing(streams[k].states[id])) {
        //TODO: request from one random stream, with the others in lazy mode. (DONE)
        if(!state)
          streams[k].request(id, -1) //blocking or otherwise not replicating this feed.
        else if(first) {
          streams[k].request(id, clock.value[id] || 0)
          first = false
        }
        //note: there isn't a way to express I want this feed, I don't have any, and don't send it to me.
        //      so I'm just gonna request it from the first connection.
        else if(clock.value[id]) {
          streams[k].request(id, ~clock.value[id])
        }
      }
    }
  }

  return self = {
    onRequest: function (id, seq, other) {
      //incase this is one we skipped, but the remote has an update
      //TODO: request from one random stream, with the others in lazy mode. (DONE)
      var receiving = false
      for(var k in streams) {
        if(k !== other && streams[k].states[id] && streams[k].states[id].remote.tx)
          receiving = true
      }
      if(!following[id])
        streams[other].request(id, -1)
      else if (!receiving)
        streams[other].request(id, clock.value[id] | 0)
      else if(clock.value[id])
        streams[other].request(id, ~clock.value[id])
      else
        //if they request a feed that we want but didn't ask them for yet and don't have any of, ask.
        //this would be a weird edge case, so err on the side of asking for the feed.
        streams[other].request(id, 0)
    },
    request: request,
    add: function (id, stream) {
      streams[id] = stream
      status[id] = status[id] || {}
      store.ensure(id, function () {
        var _clock = store.get(id)
        //check if this is already requested on another stream and do not request in eagre mode twice.
        status[id].req =
          shouldReplicate(following, _clock, clock.value, stream.request)
        //^ this may call stream.request(id, seq)
        //which will then set 
        stream.next()
      })
      return stream
    },
    onAppend: function (msg) {
      for(var k in streams)
        streams[k].onAppend(msg)
    },
    //called when messages received, write to clock store.
    //note, this is debounced, should not be call every message
    update: function (id) {
      var stream = streams[id]
      status[id] = status[id] || {}
      status[id].progress = streams[id].progress()
      status[id].feeds = countKeys(streams[id].states)

      var states = stream.states
      store.ensure(id, function () {
        var _clock = store.get(id) || {}
        for(var k in states)
          if(states[k].remote.req != null)
            _clock[k] = states[k].remote.req
        if(!isEmpty(_clock)) store.set(id, _clock)
      })
    },
    progress: function () {
      var p = {start:0, current:0, target: 0}
      for(var k in streams)
        progressReduce(p, streams[k].progress())
      return p
    },
    status: function () {
      for(var k in streams) {
        status[k].progress = streams[k].progress()
        status[k].meta = streams[k].meta
      }
      return status
    }
  }
}

