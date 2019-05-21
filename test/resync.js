var gen = require('ssb-generate')
var crypto = require('crypto')
var ssbKeys = require('ssb-keys')

function randint (n) {
  return ~~(Math.random()*n)
}

function randary (a) {
  return a[randint(a.length)]
}

function randbytes (n) {
  return crypto.randomBytes(n)
}


function track(bot, name) {
  var l = 0, _l = 0
  bot.post(function (msg) {
    l++
  })
  setInterval(function () {
    if(_l != l) {
      console.log(name, l, l - _l)
      _l = l
    }
  }, 1000).unref()
}

var alice = ssbKeys.generate()

  var createSbot = require('ssb-server')
    .use(require('ssb-replicate'))
    .use(require('../'))
    .use(require('ssb-friends'))

  var timeout = 2000

  var a_bot = createSbot({
    temp: 'alice',
    port: 45451, host: 'localhost', timeout: timeout,
    replicate: {hops: 3, legacy: false},
    keys: alice
  })

  const bob = ssbKeys.generate()


  console.log('address?', a_bot.getAddress())
  if(!a_bot.getAddress())
    throw new Error('a_bot has not address?')

  var b_bot = createSbot({
    temp: 'bob',
    port: 45452, host: 'localhost', timeout: timeout,
    replicate: {hops: 3, legacy: false},
    keys: bob
  })

  a_bot.publish({
    type:'contact',
    contact: b_bot.id,
    following: true
  }, function () {})

  track(a_bot, 'alice')
  track(b_bot, 'bob')

//  b_bot.post(console.log)

  gen.initialize(a_bot, 50, 4, function (err, peers) {
    if(err) throw err

    //in this test, bob's feed is on alice,
    //because bob's database corrupted (but had key backup)
    peers.push(a_bot.createFeed(bob))

    console.log('initialized')
    //console.log(peers.map(function (e) { return e.id }))
    gen.messages(function (n) {
      if(Math.random() < 0.3)
        return {
          type: 'contact', contact: randary(peers).id,
          following: true
        }
      return {
        type: 'test',
        ts: Date.now(),
        random: Math.random(),
        value: randbytes(randint(1024)).toString('base64')
      }
    }, peers, 1000, function () {
      console.log('done, replicating')
      b_bot.connect(a_bot.getAddress(), function (err) {
        if(err) throw err
        var int = setInterval(function () {
          console.log(JSON.stringify(b_bot.status().ebt))

          a_bot.getVectorClock(function (err, clock) {
            b_bot.getVectorClock(function (err, _clock) {
              var d = 0
              function count (o) {
                var t = 0, s = 0
                for(var k in o) {
                  t++
                  s += o[k]
                }
                return {total: t, sum: s}
              }
              var c = 0
              for(var k in _clock) {
                if(clock[k] !== _clock[k]) {
                  d += (clock[k] || 0) - _clock[k]
                }
                else
                  c++
              }

              console.log('A', count(clock), 'B', count(_clock), 'diff', d, 'common', c)
              if(d === 0 && c ) {
                clearInterval(int)
                console.log('close...')
                a_bot.close()
                b_bot.close()
              }
            })
          })

        },1000).unref()
      })
    })
  })
