# ssb-ebt

Adapter for [epidemic-broadcast-trees](https://github.com/dominictarr/epidemic-broadcast-trees)
to [secure-scuttlebutt](http://scuttlebutt.nz/)


## testing/debugging

There are several scripts in `./debug` which I used for testing
ebt replicaiton.

use `./debug/remote.js <address>` to connect to an sbot running
ebt and replicate. Running this won't store anything locally,
it will just download everything drop it on the floor. This
is used to test performance of ebt on a server.

I normally see values between 2k and 3k messages per second,
that replicates 100k messages in under a minute.

## api

### ebt.replicate (opts)

creates a duplex replication stream to the remote peer.
when two peers connect, the peer who initiated the call
(the client) should call this. It is not intended to
be called by the user.

### ebt.request (feedId, toReplicate)

request that `feedId` be replicated. `toReplicate` is
a boolean, replicate feed if true. If set to false,
replication is immediately stopped.

### ebt.peerStatus (id, cb)

query the status of replication for id.
returns a small data structure showing the replication
state for all peers we are currently connected to.

output looks like this:
``` js
{
  "id": "@EMovhfIrFk4NihAKnRNhrfRaqIhBv1Wj8pTxJNgvCCY=.ed25519",
  "seq": 13293, //the sequence we have locally.
  "peers": {
    //where each of these peers are up to:
    "@TRE4lNNXrtx3KK9Tgks2so2PjCP6w9tRvsy7wyqiyo4=.ed25519": {
      "seq": 13293, //the sequence this peer has acknoledged, we definitely know they have this number.
      "replicating": {
        "tx": true,
        "rx": true,
        "sent": 13293, //the sequence we have sent to this peer. They _probably_ have this, but not gauranteed.
        "requested": 13293 //the sequence we requested from this peer
      }
    },
    "@h1fDsZgwBtZndnRDHCFV84TMZYl16m3zhyTTQsE/V94=.ed25519": {
      "seq": 13293,
      "replicating": {
        "tx": true,
        "rx": false,
        "sent": 13293,
        "requested": 13293
      }
    }
  }
}
```

## License

MIT

