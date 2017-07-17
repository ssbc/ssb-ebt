'use strict'

var toUrlFriendly = require('base64-url').escape

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

var Store = require('lossy-store')
var path = require('path')

module.exports = function (dir, clock, status) {

  var _store = Store(dir)

  var store = {
    ensure: function (key, cb) {
      clock.once(function () {
        _store.ensure(key, cb)
      })
    },
    get: function (key) {
      return _store.get(toUrlFriendly(key))
    },
    set: function (key, value) {
      return _store.set(toUrlFriendly(key), value)
    }
  }
  var following = {}, streams = {}, self

  function request (id, state) {
    state = state !== false //true unless explicitly false
    if(following[id] === state) return
    following[id] = state
    //start all current streams following this one.
    for(var k in streams) {
      if(state !== isFollowing(streams[k].states[id])) {
        streams[k].request(id, state ? clock.value[id] || 0 : -1)
      }
    }
  }

  return self = {
    onRequest: function (id, seq, other) {
      //incase this is one we skipped, but the remote has an update
      streams[other].request(id, following[id] ? clock.value[id]|0 : -1)
    },
    request: request,
    add: function (id, stream) {
      streams[id] = stream
      store.ensure(id, function () {
        var _clock = store.get(id)
        status[id].req =
          shouldReplicate(following, _clock, clock.value, stream.request)
        stream.next()
      })
      return stream
    },
    onAppend: function (msg) {
      for(var k in streams)
        streams[k].onAppend(msg)
    },
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






