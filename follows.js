'use strict'
function countKeys (o) {
  var n = 0
  for(var k in o) n++
  return n
}

exports.shouldReplicate = function (following, _clock, clock, request) {

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






