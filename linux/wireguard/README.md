# WireGuard

`wg-template.sh` writes a starter config under `./out/` using `wg genkey` when that tool is installed. It does not enable a tunnel and it does not contact a server.

Apply a config yourself, after you have read it:

```bash
sudo cp out/wg0.conf /etc/wireguard/wg0.conf
sudo chmod 600 /etc/wireguard/wg0.conf
sudo wg-quick up wg0
```

fiaOS only lists interface names from `/etc/wireguard/*.conf`. It does not read private keys. `GET /api/local/wireguard` reports whether `wg` is installed.
