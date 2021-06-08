const pull = require('pull-stream')
const isFeed = require('ssb-ref').isFeed

module.exports = function (sbot, ebt) {
  function handleBlockUnlock (from, to, value) {
    if (value === false) { ebt.block(from, to, true) } else if (ebt.state.blocks[from] && ebt.state.blocks[from][to]) { ebt.block(from, to, false) }
  }

  setImmediate(function () {
    if (sbot.friends) {
      pull(
        sbot.friends.stream({ live: true }),
        pull.drain(function (contacts) {
          if (!contacts) return

          if (isFeed(contacts.from) && isFeed(contacts.to)) { // live data
            handleBlockUnlock(contacts.from, contacts.to, contacts.value)
          } else { // initial data
            for (const from in contacts) {
              const relations = contacts[from]
              for (const to in relations) { handleBlockUnlock(from, to, relations[to]) }
            }
          }
        })
      )
    }
  })
}
