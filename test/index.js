const tape = require('tape')
const crypto = require('crypto')
const ssbKeys = require('ssb-keys')
const pify = require('promisify-4loc')
const sleep = require('util').promisify(setTimeout)
const SecretStack = require('secret-stack')
const u = require('./misc/util')

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

const CONNECTION_TIMEOUT = 500
const REPLICATION_TIMEOUT = 2 * CONNECTION_TIMEOUT

const alice = createSbot({
  temp: 'random-animals_alice',
  timeout: CONNECTION_TIMEOUT,
  replicate: { legacy: false },
  keys: ssbKeys.generate(),
  friends: { hops: 10 }
})

const bob = createSbot({
  temp: 'random-animals_bob',
  timeout: CONNECTION_TIMEOUT,
  replicate: { legacy: false },
  friends: { hops: 10 },
  keys: ssbKeys.generate()
})

const charles = createSbot({
  temp: 'random-animals_charles',
  timeout: CONNECTION_TIMEOUT,
  replicate: { legacy: false },
  friends: { hops: 10 },
  gossip: { pub: false },
  keys: ssbKeys.generate()
})

const names = {
  [alice.id]: 'alice',
  [bob.id]: 'bob',
  [charles.id]: 'charles',
}

tape('three peers replicate everything between each other', async (t) => {
  t.plan(6)

  const bots = [alice, bob, charles]

  // make sure all the sbots are replicating all the feeds.
  for (const bot of bots) {
    alice.replicate.request(bot.id)
    bob.replicate.request(bot.id)
    charles.replicate.request(bot.id)
  }
  t.pass('all peers are set to replicate each other')

  const allMsgKeys = new Set()
  const recv = {
    alice: new Set(),
    bob: new Set(),
    charles: new Set(),
  }

  function consistent (name) {
    if (!name) throw new Error('name must be provided')
    return function (msg) {
      u.log(name, 'received', msg.value.content, 'by', names[msg.value.author])
      allMsgKeys.add(msg.key)
      recv[name].add(msg.key)
    }
  }

  alice.post(consistent('alice'))
  bob.post(consistent('bob'))
  charles.post(consistent('charles'))

  await Promise.all([
    pify(alice.publish)({ type: 'post', text: 'hello world' }),
    pify(bob.publish)({ type: 'post', text: 'hello world' }),
    pify(charles.publish)({ type: 'post', text: 'hello world' }),
  ])
  t.pass('all peers have posted "hello world"')

  await Promise.all([
    pify(alice.connect)(bob.getAddress()),
    pify(alice.connect)(charles.getAddress()),
    pify(charles.connect)(bob.getAddress()),
  ])
  t.pass('the three peers are connected to each other as a triangle')

  const AMOUNT = 10;
  for (let i = 0; i < AMOUNT; i++) {
    const j = ~~(Math.random() * bots.length)
    u.log('publish a new post by ' + names[bots[j].id])
    await pify(bots[j].publish)({ type: 'post', text: '' + i })
  }
  t.pass(`${AMOUNT} random messages were posted`)

  await sleep(REPLICATION_TIMEOUT)
  t.pass('wait for replication to complete')

  for (const msgKey of allMsgKeys) {
    if (!recv.alice.has(msgKey)) t.fail('alice is missing msg ' + msgKey)
    if (!recv.bob.has(msgKey)) t.fail('bob is missing msg ' + msgKey)
    if (!recv.charles.has(msgKey)) t.fail('charles is missing msg ' + msgKey)
  }
  t.pass('all peers have all messages')

  await Promise.all([
    pify(alice.close)(true),
    pify(bob.close)(true),
    pify(charles.close)(true),
  ]);
  t.end()
  return
})