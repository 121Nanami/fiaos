# House chat (Conduit)

The Desk panel keeps a room in `data/matrix-room.json` so chat works with nothing else installed.

To run a real homeserver on this machine, [Conduit](https://conduit.rs) is a small Matrix server. A starting config is `conduit.toml.example`. Copy it, set a registration token you choose, and run Conduit on `127.0.0.1:6167`. fiaOS checks `MATRIX_URL` (default `http://127.0.0.1:6167`) for `/_matrix/client/versions`.

The panel does not create accounts on a public server and does not use a hosted Matrix provider. Federation, if you enable it in Conduit, is your choice in that config.
