# Headscale

Headscale is a self-hosted coordination server for a WireGuard mesh (the same idea as a hosted tailnet, run by you). fiaOS does not install it and does not open an account anywhere.

On the machine that should coordinate:

1. Install `headscale` from your distro or the project’s release.
2. Listen on localhost first (`127.0.0.1:8082` is a common choice; pick a port that is not fiaOS).
3. Create a user and a pre-auth key with the `headscale` CLI.
4. On each other machine, install WireGuard and the tailscale client, then `tailscale up --login-server http://<that-host>:<port> --authkey <key>`.

Keep the coordination port off the public internet until the config is one you have reviewed. Private keys stay in WireGuard’s own files. The template in `linux/wireguard/wg-template.sh` is the manual version of the same tunnel, without Headscale.
