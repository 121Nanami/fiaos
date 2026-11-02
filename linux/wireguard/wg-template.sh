#!/bin/sh
# Write a WireGuard template next to this script. Does not bring an interface up.
set -eu
out=$(dirname "$0")/out
mkdir -p "$out"
if ! command -v wg >/dev/null 2>&1; then
  echo "wg is not installed. Install wireguard-tools, then run this again." >&2
  exit 1
fi
priv=$(wg genkey)
pub=$(printf '%s\n' "$priv" | wg pubkey)
umask 077
cat > "$out/wg0.conf" <<EOF
# Starter. Replace Address, peer endpoint and peer key before use.
[Interface]
PrivateKey = $priv
Address = 10.10.10.2/32
ListenPort = 51820

[Peer]
PublicKey = REPLACE_WITH_THE_OTHER_SIDE
AllowedIPs = 10.10.10.0/24
Endpoint = 127.0.0.1:51820
PersistentKeepalive = 25
EOF
printf '%s\n' "$pub" > "$out/public.key"
echo "Wrote $out/wg0.conf (mode 600). Public key is in $out/public.key."
echo "This script did not start WireGuard."
