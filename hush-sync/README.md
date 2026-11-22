# hush-sync

A tiny self-hosted relay for **hush Listen Together**. It only routes small control messages between hush instances — no audio and no music credentials pass through it.

## Run it

```bash
cd hush-sync
cargo run --release
# [hush-sync] listening on 0.0.0.0:8787
```

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `HUSH_SYNC_BIND` | `0.0.0.0:8787` | Bind address/port |

Point hush at it in **Settings → Listen together → Relay URL**:

```
ws://your-host:8787
```

## Docker

```bash
docker build -t hush-sync .
docker run --rm -p 8787:8787 hush-sync
```

## TLS (recommended for anything beyond a LAN)

Put the relay behind a TLS-terminating reverse proxy and use `wss://`. Caddy example:

```caddyfile
sync.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Then set the hush relay URL to `wss://sync.example.com`.

## How it works

- A host creates a room and receives a 6-character code.
- Guests join with the code.
- The host forwards `{track, position, playing, hostClock}`; the relay fans it out.
- Guests estimate the host clock with NTP-style `syncReq`/`syncResp` messages and correct drift locally.
- When a host disconnects, the relay promotes the earliest remaining member and broadcasts `hostChanged`.
- Rooms are in memory and disappear when empty. There is no persistence.

## Security notes

- Anyone with the 6-character code can join a room. Treat codes like a shared secret.
- The relay sees display names and track metadata/positions, but never Navidrome credentials or audio.
- Use `wss://` and a firewall for anything beyond a trusted LAN.
- Rooms are capped at 16 members.

## Protocol

Types live in [`protocol/src/lib.rs`](./protocol/src/lib.rs) and are shared by hush and the relay.

Messages are JSON over WebSocket:

- client: `hello`, `create`, `join`, `leave`, `state`, `syncReq`, `syncResp`, `heartbeat`
- server: `welcome`, `created`, `joined`, `memberJoined`, `memberLeft`, `hostChanged`, `state`, `syncReq`, `syncResp`, `error`
