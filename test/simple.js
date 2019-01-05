var cont = require('cont')
var pull = require('pull-stream')
var RNG = require('rng')
var rng = new RNG.MT(0)

var createSbot = require('ssb-server')
  .use({
    //fake replicate plugin
    name: 'replicate',
    init: function () {
      return {request: function () {}}
    }
  })
  .use(require('../')) //EBT

function Delay (d) {
  d = d || 100
  return pull.asyncMap(function (data, cb) {
    setTimeout(function () {
      cb(null, data)
    }, ~~(d + Math.random()*d))
  })
}

var ssbKeys   = require('ssb-keys')

var a_seed = new Buffer(32)
a_seed.fill('A')
var b_seed = new Buffer(32)
b_seed.fill('B')

function createSeed() {
  var b = new Buffer(32)
  for(var i = 0; i < b.length; i++)
    b[i] = rng.next()
  return b
}

var alice = ssbKeys.generate(null, a_seed)
var bob = ssbKeys.generate(null, b_seed)

var a_bot = createSbot({
  temp: 'random-animals_alice',
  port: 45451, host: 'localhost', timeout: 20001,
  replicate: {hops: 3, legacy: false}, keys: alice
})

var b_bot = createSbot({
  temp: 'random-animals_bob',
  port: 45452, host: 'localhost', timeout: 20001,
  replicate: {hops: 3, legacy: false},
  keys: bob
})

//increasing n give an error currently...
var N = 3
var n = N
var feeds = [a_bot.createFeed(alice), b_bot.createFeed(bob)]

while(n-->0) {
  var j = ~~(rng.random()*2)
  var key = ssbKeys.generate(null, createSeed())
  console.log(j, key.id)
  feeds.push([a_bot, b_bot][j].createFeed(key))
}
//make sure all the sbots are replicating all the feeds.
feeds.forEach(function (f) {
  a_bot.replicate.request(f.id)
  b_bot.replicate.request(f.id)
})

var all = {}, recv = {}

function consistent (name) {
  if(!name) throw new Error('name must be provided')
  recv[name] = {}
  return function (msg) {
    recv[name][msg.key] = true
    all[msg.key] = true
    var missing = 0, has = 0
    for(var k in all) {
      for(var n in recv) {
        if(!recv[n][k]) {
          console.log('missing:', n, k)
          missing ++
        }
        else
          has ++
      }
    }

    console.log('missing/has' ,missing, has)
    if(!missing)
      console.log('CONSISTENT!!!')
  }
}

function log (name) {
  return pull.through(function (data) {
    console.log(name, data)
  })
}

function peers (a, b, name1, name2, d) {
  var a_rep = a.ebt.replicate.call({id: name2}, {version: 2})
  var b_rep = b.ebt.replicate.call({id: name1}, {version: 2})

  pull(
    a_rep,
    Delay(d),
    log(name1+'->'+name2),
    b_rep,
    Delay(d),
    log(name2+'->'+name1),
    a_rep
  )
}


a_bot.post(consistent('alice'))
b_bot.post(consistent('bob'))

cont.para(feeds.map(function (f) {
  return f.publish({type:'post', text: 'hello world'})
}))(function () {
  peers(a_bot, b_bot, 'a', 'b', 10)
})

var i = N
var int = setInterval(function () {
  var feed = feeds[~~(rng.random()*feeds.length)]
  feed.publish({type:'post', text: i.toString()}, function () {})

  if(--i) return

  clearInterval(int)

  console.log('Alice', a_bot.since())
  console.log('Bob', b_bot.since())

  //and check that all peers are consistent.
  setTimeout(function () {
    a_bot.close()
    b_bot.close()
  }, 1000)

//  setTimeout(next, 100)
}, 500)


function next () {
  //reload previous databases, from /tmp
  //but without using the temp option, so they are not deleted.
  var a_bot = createSbot({
    path: '/tmp/random-animals_alice',
    port: 45451, host: 'localhost', timeout: 20001,
    replicate: {hops: 3, legacy: false}, keys: alice
  })

  var b_bot = createSbot({
    path: '/tmp/random-animals_bob',
    port: 45452, host: 'localhost', timeout: 20001,
    replicate: {hops: 3, legacy: false},
    keys: bob
  })

  //make sure all feeds are requested.
  feeds.forEach(function (f) {
    a_bot.replicate.request(f.id)
    b_bot.replicate.request(f.id)
  })

  a_bot.publish({type:'post', content: 'hello bob'}, function () {

    peers(a_bot, b_bot, 'a', 'b', 10)

    a_bot.post(console.log)
    b_bot.post(console.log)
    var j = 10

    var int = setInterval(function () {
      if(!j--) {
        console.log('FAILED')
        console.log(JSON.stringify(a_bot.ebt._state(), null, 2))
        console.log(JSON.stringify(b_bot.ebt._state(), null, 2))

        process.exit(1)
      }
      a_bot.getVectorClock(function (err, clock) {
        b_bot.getVectorClock(function (err, _clock) {
          for(var k in clock)
            if(_clock[k] !== clock[k]) {
              console.log('differs', k, _clock[k], clock[k])
              return
            }
          for(var k in _clock)
            if(_clock[k] !== clock[k]) {
              console.log('differs', k, _clock[k], clock[k])
              return
            }
          clearInterval(int)
          console.log("CLOCKS", clock, _clock)
          console.log('CONSISTENT', clock)
          setTimeout(function () {
            a_bot.close(function (err) {
              b_bot.close(function () {})

            })
          }, 10000)
        })
      })
    }, 100)
  })
}




