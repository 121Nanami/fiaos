# Tor for Facet

Facet can open `.onion` sites when Tor is running on this machine. fiaOS does not ship Tor and does not phone home.

1. Install Tor from your distro (`tor` on Debian or Fedora).
2. Start it. The default SOCKS port is `127.0.0.1:9050`.
3. In the Facet Electron app, set the proxy to `socks5://127.0.0.1:9050` for onion addresses.
4. Facet should still send bookmarks and history to `http://127.0.0.1:8080/api/facet/*` (that traffic stays on the machine and does not go through Tor).

The start page is [facet.html](http://127.0.0.1:8080/facet.html). It refuses `javascript:` and `data:` links.

A hidden service, if you want one, is configured in Tor’s own `torrc` (`HiddenServiceDir` and `HiddenServicePort`). Point that port at the fiaOS server only if you intend the house to be reachable that way. Do not publish the data directory.
