var cont = require('cont')
var pull = require('pull-stream')
var createSbot = require('scuttlebot')
  .use(require('../')) //EBT
//  .use(require('../plugins/friends'))
//  .use(require('../plugins/replicate'))
//  .use(require('../plugins/gossip'))

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
  replication: {hops: 3}, keys: alice
})

var b_bot = createSbot({
  temp: 'random-animals2',
  port: 45452, host: 'localhost', timeout: 20001,
  replication: {hops: 3}, keys: bob
})

var c_bot = createSbot({
  temp: 'random-animals3',
  port: 45453, host: 'localhost', timeout: 20001,
  replication: {hops: 3}, keys: charles
})

var n = 10
var feeds = [a_bot.createFeed(alice), b_bot.createFeed(bob), c_bot.createFeed(charles)]
while(n-->0)
  feeds.push([a_bot, b_bot, c_bot][~~(Math.random()*3)].createFeed())

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
    var a_rep = a.ebt.replicate()
    var b_rep = b.ebt.replicate()


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

setInterval(function () {
  console.log('post')
  feeds[~~(Math.random()*feeds.length)].publish({type:'post', text: new Date().toString()}, function () {})
}, 1000)

