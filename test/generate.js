var gen = require('ssb-generate')
var pull = require('pull-stream')
var paramap = require('pull-paramap')
var crypto = require('crypto')
var ssbKeys = require('ssb-keys')
var assert = require('assert')

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
  var l = 0, _ts = Date.now(), _l = 0
  bot.post(function (msg) {
    l++
  })
  setInterval(function () {
    if(_l != l) {
      console.log(name, l, l - _l, bot.progress())
      _l = l
    }
  }, 1000).unref()
}

//SOMETIMES this test fails. I think it's just because
//some of the peers might be too far from the followed peer.
//TODO: create a thing that checks they where all actually reachable!

var alice = ssbKeys.generate()

  var createSbot = require('scuttlebot')
    .use(require('scuttlebot/plugins/replicate'))
    .use(require('../'))
    .use(require('ssb-friends'))

  var a_bot = createSbot({
    temp: 'alice',
    port: 45451, host: 'localhost', timeout: 20001,
    replicate: {hops: 3, legacy: false},
    keys: alice
  })


  console.log('address?', a_bot.getAddress())
  if(!a_bot.getAddress())
    throw new Error('a_bot has not address?')

  var b_bot = createSbot({
    temp: 'bob',
    port: 45452, host: 'localhost', timeout: 20001,
    replicate: {hops: 3, legacy: false},
    keys: ssbKeys.generate()
  })

  a_bot.publish({
    type:'contact',
    contact: b_bot.id,
    following: true
  }, function () {})

  track(a_bot, 'alice')
  track(b_bot, 'bob')

  gen.initialize(a_bot, 500, 4, function (err, peers) {
    if(err) throw err
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
    }, peers, 10000, function () {
      var c = 0
      console.log('set up, replicating')
      ;(function next (i) {
        if(!i) {
          return
        }

        b_bot.publish({
          type: 'contact',
          contact: randary(peers).id, //a_bot.id,
          following: true
        }, function (err, msg) {
          if(err) throw err
          next(i - 1)

        })
      })(50)

      b_bot.connect(a_bot.getAddress(), function (err) {
        if(err) throw err
        var int = setInterval(function () {
          console.log(JSON.stringify(b_bot.status().ebt))

          var prog = a_bot.progress()
          assert.ok(prog.indexes)
          assert.ok(prog.ebt)
          assert.ok(prog.ebt.target)

          a_bot.getVectorClock(function (err, clock) {
            b_bot.getVectorClock(function (err, _clock) {
              var d = 0, total_a = 0, total_b = 0
              function count (o) {
                var t = 0, s = 0
                for(var k in o) {
                  t++
                  s += o[k]
                }
                return {total: t, sum: s}
              }

              for(var k in _clock) {
                total_a += _clock[k]
                if(clock[k] !== _clock[k]) {
                  d += (clock[k] || 0) - _clock[k]
                }
              }
              for(var k in clock)
                total_b += clock[k]

              console.log('A',count(clock), 'B', count(_clock), 'diff', d)
              if(d === 0) {
                  var prog = a_bot.progress()
                  assert.ok(prog.indexes)
                  assert.ok(prog.ebt)
                  assert.ok(prog.ebt.target)
                  assert.equal(prog.ebt.current, prog.ebt.target)
                  clearInterval(int)
                  a_bot.close()
                  b_bot.close()
              }
            })
          })
        },1000).unref()
      })
    })
  })

