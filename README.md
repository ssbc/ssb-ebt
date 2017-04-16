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

## License

MIT

