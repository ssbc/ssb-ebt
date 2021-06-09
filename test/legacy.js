const tape = require('tape')
const crypto = require('crypto')
const ssbKeys = require('ssb-keys')
const SecretStack = require('secret-stack')

const createSbot = SecretStack({
  caps: { shs: crypto.randomBytes(32).toString('base64') }
})
  .use(require('ssb-db'))
  .use({
    // fake replicate plugin
    name: 'replicate',
    init: function () {
      return { request: function () {} }
    }
  })
  .use(require('../')) // EBT

const alice = ssbKeys.generate()
const bob = ssbKeys.generate()

const botA = createSbot({
  temp: 'random-animals',
  port: 45451,
  host: 'localhost',
  timeout: 20001,
  replicate: { hops: 3, legacy: false },
  keys: alice
})

tape('legacy', function (t) {
  setTimeout(() => {
    t.throws(function () {
      botA.ebt.replicate.call(bob, { version: 1 })
    })

    botA.close(t.end)
  }, 100)
})
