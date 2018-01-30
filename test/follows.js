var tape = require('tape')
var Follows = require('../follows')

function mockStream (onAppend, onRequest) {
  var self
  return self = {
    onAppend: onAppend.bind(self),
    states: {},
    progress: function () {
      return {start:0, current:0, target: 0}
    },
    meta: {},
    request: onRequest.bind(self),
    nexted: 0,
    next: function () {
      self.nexted ++
    }
  }
}

tape('onAppend calls all streams onAppend', function (t) {

  var clock = {}, status = {}
  var store = {
    get: function () {},
    set: function () {},
    ensure: function (id, cb) { cb() }
  }

  var f = Follows(store, clock, status)
  var a = 0
  var A = mockStream(function (msg) { a++ }, function () {})
  var B = mockStream(function (msg) { a++ }, function () {})

  f.add('a', A)
  f.add('b', B)
  f.onAppend({foo: true, bar: true})

  t.equal(a, 2)

  t.end()
})

tape('update sets the clock requested', function (t) {
  var clock = {}, status = {}
  var store = {
    get: function () {},
    set: function (id, clock) {
      t.equal(id, 'a')
      t.deepEqual(clock, {a: 1, c: -1})
      t.end()
    },
    ensure: function (id, cb) { cb() }
  }

  var f = Follows(store, clock, status)

  f.add('a', {
    states:{
      a: {remote:{req: 1}},
      b: {remote: {req: null}},
      c: {remote: {req: -1}}
    },
    progress: function () { return {start:0, current:0, target: 0} },
    next: function () {}
  })

  f.update('a')
})

tape('request', function (t) {

  var clocks = {
    a: {a: 1, b: 0, c: -1},
    b: {a: 1, b: 1, c: 2, d: 5}
  }
  var clock = {
    a: 0, b: 2, c: 1
  }, status = {}
  var store = {
    get: function (id) {
      console.log(id, clocks[id])
      return clocks[id] },
    set: function (id, clock) {},
    ensure: function (id, cb) { cb() }
  }

  var reqA = {}
  var A = mockStream(function () {}, function (id, seq) {
    reqA[id] = seq
  })
  var f = Follows(store, {value:clock}, status)
  f.request('a')
  f.request('b')
  f.request('c')

  f.add('a', A)
  //f.add('b', B)
  t.deepEqual(reqA, {a:0, b:2})

  var reqB = {}
  var a = 0
  var B = mockStream(function (msg) { a++ }, function (id, seq) {
    reqB[id] = seq
  })

  f.add('b', B)

  t.deepEqual(reqB, {a:0, b:2, c:1})


  t.end()
})

tape('progress', function (t) {
  var clock = {}, status = {}
  var store = {
    get: function () {},
    set: function (id, clock) {
      t.equal(id, 'a')
      t.deepEqual(clock, {a: 1, c: -1})
      t.end()
    },
    ensure: function (id, cb) { cb() }
  }

  var f = Follows(store, clock, status)

  f.add('a', {
    states:{
    },
    progress: function () {
      return {start: 0, current: 1, target: 10}
    },
    next: function () {}
  })

  f.add('b', {
    states:{
    },
    progress: function () {
      return {start: 0, current: 5, target: 7}
    },
    next: function () {}
  })

  t.deepEqual(f.progress(), {start: 0, current: 6, target: 17})

  t.end()


})



