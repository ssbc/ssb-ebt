const crypto = require('crypto')
const ssbKeys = require('ssb-keys')
const ref = require('ssb-ref')

exports.follow = function (id) {
  return {
    type: 'contact', contact: id, following: true
  }
}
exports.unfollow = function (id) {
  return {
    type: 'contact', contact: id, following: false
  }
}
exports.block = function unfollow (id) {
  return {
    type: 'contact', contact: id, flagged: true
  }
}

exports.pub = function (address) {
  return {
    type: 'pub',
    address: ref.parseAddress(address)
  }
}

exports.log = function (...args) {
  if (process.env.TEST_VERBOSE) console.log(...args)
}

exports.file = function (hash) {
  return {
    type: 'file',
    file: hash
  }
}

exports.keysFor = function (name) {
  const seed = crypto.createHash('sha256').update(name).digest()
  return ssbKeys.generate(null, seed)
}

exports.readOnceFromDB = function (sbot) {
  return new Promise((resolve) => {
    var cancel = sbot.post((msg) => {
      cancel()
      resolve(msg)
    }, false)
  })
}

exports.trackProgress = function (sbot, name) {
  let n = 0
  let n0 = 0
  sbot.post((msg) => n++)
  setInterval(() => {
    if (n0 !== n) {
      exports.log(name, n, n - n0, sbot.progress())
      n0 = n
    }
  }, 1000).unref()
}

exports.countClock = function (obj) {
  let total = 0
  let sum = 0
  for (const key in obj) {
    total++
    sum += obj[key]
  }
  return { total, sum }
}

exports.randint = function (max) {
  return ~~(Math.random() * max)
}

exports.randary = function (ary) {
  return ary[exports.randint(ary.length)]
}

exports.randbytes = function (size) {
  return crypto.randomBytes(size)
}
