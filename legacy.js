var pull = require('pull-stream')
var isFeed = require('ssb-ref').isFeed

module.exports = function (sbot, ebt) {
  setImmediate(function () {
    if(sbot.friends) {
      function handleBlockUnlock(from, to, value)
      {
        if (value === false)
          ebt.block(from, to, true)
        else if (ebt.state.blocks[from] && ebt.state.blocks[from][to])
          ebt.block(from, to, false)
      }

      pull(
        sbot.friends.stream({live: true}),
        pull.drain(function (contacts) {
          if(!contacts) return

          if (isFeed(contacts.from) && isFeed(contacts.to)) { // live data
            handleBlockUnlock(contacts.from, contacts.to, contacts.value)
          } else { // initial data
            for (var from in contacts) {
              var relations = contacts[from]
              for (var to in relations)
                handleBlockUnlock(from, to, relations[to])
            }
          }
        })
      )
    }
  })
}

