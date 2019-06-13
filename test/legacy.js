var cont   = require('cont')
var pull   = require('pull-stream')
var crypto = require('crypto')

var createSbot = require('secret-stack')({
    caps: {shs: crypto.randomBytes(32).toString('base64')}
  })
  .use(require('ssb-db'))
  .use({
    //fake replicate plugin
    name: 'replicate',
    init: function () {
      return {request: function () {}}
    }
  })
  .use(require('../')) //EBT

var ssbKeys   = require('ssb-keys')

var alice = ssbKeys.generate()
var bob = ssbKeys.generate()

var a_bot = createSbot({
  temp: 'random-animals',
  port: 45451, host: 'localhost', timeout: 20001,
  replicate: {hops: 3, legacy: false}, keys: alice
})

require('tape')( function (t) {

  t.throws(function () {
    var a_rep = a_bot.ebt.replicate.call(bob, {version: 1})
  })

  a_bot.close()
  t.end()
})
