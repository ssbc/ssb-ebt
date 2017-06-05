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

var alice = ssbKeys.generate()
var bob = ssbKeys.generate()
var charles = ssbKeys.generate()

var a_bot = createSbot({
  temp: 'random-animals',
  port: 45451, host: 'localhost', timeout: 20001,
  replicate: {hops: 3, legacy: false}, keys: alice
})

var b_bot = createSbot({
  temp: 'random-animals2',
  port: 45452, host: 'localhost', timeout: 20001,
  replicate: {hops: 3, legacy: false},
  keys: bob
})

var c_bot = createSbot({
  temp: 'random-animals3',
  port: 45453, host: 'localhost', timeout: 20001,
  replicate: {hops: 3, legacy: false},
  keys: charles
})

//increasing n give an error currently...
var n = 0
var feeds = [a_bot.createFeed(alice), b_bot.createFeed(bob), c_bot.createFeed(charles)]
while(n-->0)
  feeds.push([a_bot, b_bot, c_bot][~~(Math.random()*3)].createFeed())

//make sure all the sbots are replicating all the feeds.
feeds.forEach(function (f) {
  a_bot.replicate.request(f.id)
  b_bot.replicate.request(f.id)
  c_bot.replicate.request(f.id)
})

var all = {}, recv = {}

function consistent (name) {
  if(!name) throw new Error('name must be provided')
  recv[name] = {}
  return function (msg) {
    recv[name][msg.key] = true
    all[msg.key] = true
    console.log("POST", recv, all)
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

a_bot.post(consistent('alice'))
b_bot.post(consistent('bob'))
c_bot.post(consistent('charles'))

cont.para(feeds.map(function (f) {
//  console.log(f)
  return f.publish({type:'post', text: 'hello world'})
}))(function () {

//  a_bot.seq(console.log)

  function log (name) {
    return pull.through(function (data) {
      console.log(name, data)
    })
  }

  function peers (a, b, name1, name2, d) {
    var a_rep = a.ebt.replicate.call({id: name1}, {version: 2})
    var b_rep = b.ebt.replicate.call({id: name2}, {version: 2})

    pull(
      a_rep, 
      Delay(d),
      log(name1+'->'+name2),
      b_rep,
      Delay(d),
      log(name2+'->'+name1),
      a_rep)
  }

  peers(a_bot, b_bot, 'a', 'b', 10)
  peers(a_bot, c_bot, 'a', 'c', 10)
  peers(c_bot, b_bot, 'c', 'b', 7)

})

var i = 5
var int =
setInterval(function () {
  console.log('post', a_bot.since())
  feeds[~~(Math.random()*feeds.length)].publish({type:'post', text: new Date().toString()}, function () {})
  if(--i) return
  clearInterval(int)

  console.log('Alice', a_bot.since())
  console.log('Bob', a_bot.since())
  console.log('Charles', a_bot.since())

  //and check that all peers are consistent.

  a_bot.close()
  b_bot.close()
  c_bot.close()
}, 500)

