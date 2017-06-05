var cont = require('cont')
var pull = require('pull-stream')
var createSbot = require('scuttlebot')
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
//  return pull.through()
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


var alice = ssbKeys.generate(null, a_seed)
var bob = ssbKeys.generate(null, b_seed)
//var charles = ssbKeys.generate(null, 'charles')

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
var n = 0
var feeds = [a_bot.createFeed(alice), b_bot.createFeed(bob)]
while(n-->0)
  feeds.push([a_bot, b_bot][~~(Math.random()*2)].createFeed())

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
//  console.log(f)
  return f.publish({type:'post', text: 'hello world'})
}))(function () {

  peers(a_bot, b_bot, 'a', 'b', 10)
})

var i = 10
var int =
setInterval(function () {
  console.log('post', a_bot.since())
  feeds[~~(Math.random()*feeds.length)].publish({type:'post', text: new Date().toString()}, function () {})
  if(--i) return
  clearInterval(int)

  console.log('Alice', a_bot.since())
  console.log('Bob', b_bot.since())

  //and check that all peers are consistent.

  a_bot.close()
  b_bot.close()
  setTimeout(next, 100)
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

  a_bot.replicate.request(b_bot.id)
  b_bot.replicate.request(a_bot.id)
  a_bot.replicate.request(a_bot.id)
  b_bot.replicate.request(b_bot.id)

  console.log(
    "LOADED, Bob's Alice:",
    require('fs').readFileSync('/tmp/random-animals_bob/ebt/a', 'utf8')
  )
  console.log(
    "LOADED, Alice's Bob:",
    require('fs').readFileSync('/tmp/random-animals_alice/ebt/b', 'utf8')
  )

  a_bot.publish({type:'post', content: 'hello bob'}, function () {

    peers(a_bot, b_bot, 'a', 'b', 10)

    a_bot.post(console.log)
    b_bot.post(console.log)

    var int = setInterval(function () {

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
          console.log('CONSISTENT', clock)
          a_bot.close()
          b_bot.close()
        })
      })
    }, 100)

  })
}





