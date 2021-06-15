const tape = require('tape')
const crypto = require('crypto')
const ssbKeys = require('ssb-keys')
const pify = require('promisify-4loc')
const sleep = require('util').promisify(setTimeout)
const SecretStack = require('secret-stack')

const createSbot = SecretStack({
  caps: { shs: crypto.randomBytes(32).toString('base64') }
})
  .use(require('ssb-db'))
  .use(require('../')) // EBT

const CONNECTION_TIMEOUT = 500 // ms

const bobKeys = ssbKeys.generate()

const alice = createSbot({
  temp: 'random-animals',
  timeout: CONNECTION_TIMEOUT,
  keys: ssbKeys.generate()
})

tape('legacy (version 1) is unsupported', async (t) => {
  t.plan(1);

  // Wait for alice to be ready, so that it *can* be closed
  await sleep(500)

  t.throws(function () {
    alice.ebt.replicate.call(bobKeys, { version: 1 })
  })

  await pify(alice.close)(true)
  t.end()
})
