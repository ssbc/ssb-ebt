# ssb-ebt

*Replicates SSB feeds using the efficient "Epidemic broadcast tree" algorithm.*

This module is an adapter for the module [epidemic-broadcast-trees](https://github.com/ssbc/epidemic-broadcast-trees)
to work with [secure-scuttlebutt](http://scuttlebutt.nz/). Supersedes
[ssb-replicate](https://github.com/ssbc/ssb-replicate).

## Installation

**Prerequisites:**

- Requires **Node.js 10** or higher
- Requires **ssb-db** or **ssb-db2**

```
npm install --save ssb-ebt
```

Add this secret-stack plugin like this:

```diff
 const SecretStack = require('secret-stack')
 const caps = require('ssb-caps')

 const createSsbServer = SecretStack({ caps })
     .use(require('ssb-master'))
     .use(require('ssb-db'))
+    .use(require('ssb-ebt'))
     .use(require('ssb-friends'))
     // ...
```

## Usage

ssb-ebt itself does **NOT** trigger replication automatically after it's
installed, instead, you need to call its API methods yourself (primarily
`request` or `block`), or use a scheduler module such as
[ssb-replication-scheduler](https://github.com/ssb-ngi-pointer/ssb-replication-scheduler).

### `ssb.ebt.request(destination, replicating)` ("sync" muxrpc API)

Request that the SSB feed ID `destination` be replicated. `replication` is a
boolean, where `true` indicates we want to replicate the destination. If set to
`false`, replication is stopped.

Returns undefined, always.

### `ssb.ebt.block(origin, destination, blocking)` ("sync" muxrpc API)

Computes that `origid` does not want to replicate `destination`'s feed. Also
disallows other peers (who have this same ssb-ebt installed) to pass on data to
them.

`origin` is the SSB feed ID of the peer who created the block, `destination` is
the SSB feed ID of the peer being blocked, and `blocking` is a boolean that
indicates whether to enable the block (`true`) or to unblock (`false`).

Returns undefined, always.

### `ssb.ebt.peerStatus(id)` ("sync" muxrpc API)

Query the status of replication for a given SSB feed ID `id`. Returns a JSON
object showing the replication state for all peers we are currently
connected to.

The output looks like this:

<details>
<summary>CLICK HERE</summary>

```js
{
  "id": "@EMovhfIrFk4NihAKnRNhrfRaqIhBv1Wj8pTxJNgvCCY=.ed25519",
  "seq": 13293, //the sequence we have locally.
  "peers": {
    //where each of these peers are up to:
    "@TRE4lNNXrtx3KK9Tgks2so2PjCP6w9tRvsy7wyqiyo4=.ed25519": {
      "seq": 13293, //the sequence this peer has acknowledged, we definitely know they have this number.
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

</details>

### (Internal) `ssb.ebt.replicate(opts)` ("duplex" muxrpc API)

Creates a duplex replication stream to the remote peer. When two peers connect,
the peer who initiated the call (the client) should call this. You do not need
to call this method, it is called automatically in ssb-ebt whenever our peer
connects to a remote peer. `opts` is an object with one field: `version`.

### (Internal) `ssb.ebt.replicateFormat(opts)` ("duplex" muxrpc API)

Creates a duplex replication stream to the remote peer. This behaves
similar to `replicate` except it takes an extra field `format`
specifying what is transferred over this EBT stream. Classic feeds are
still replicated using `replicate` while this will be used to
replicate other feed formats.

### (Internal) `ssb.ebt.clock(opts, cb)` ("async" muxrpc API)

Gets the current vector clock of a remote peer. `opts` is an object
with one field: `format` specifying what format to get the vector
clock for. Defaults to 'classic'.

## Testing and debugging

There are several scripts in `./debug` which can be used for testing EBT
replication.

Use `./debug/remote.js <address>` to connect to an SSB peer running EBT. Running
this won't store anything locally, it will just download everything and drop it
on the floor. This is used to test performance of EBT on a server.

We normally see values between 2k and 3k messages per second, in other words,
replicates 100k messages in under a minute.

## License

MIT
