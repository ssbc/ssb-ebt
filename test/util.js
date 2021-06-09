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
