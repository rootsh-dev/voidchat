# Void Chat

Peer-to-peer chat application. Messages are exchanged directly between
browsers over WebRTC; no message data passes through or is stored on any
server. A minimal backend exists solely to issue short-lived, scoped
authentication tokens for the signaling service.

## Stack

- Frontend: static HTML/CSS/JS (no build step)
- Backend: single Flask route, deployed as a Vercel serverless function
- Signaling: Ably (Realtime + Presence)
- WebRTC: STUN (Google) with TURN fallback (Open Relay)

## Architecture

1. Client requests a token from `/api/token`, specifying a room ID
2. The server requests a token from Ably, scoped to that room and valid
   for one hour, using a server-side API key
3. The client connects to Ably using the scoped token
4. Ably relays WebRTC signaling data (SDP offers/answers, ICE candidates)
   between the two clients
5. Once the peer connection is established, chat messages are sent
   directly between browsers via a WebRTC data channel

The Ably API key is never exposed to the client.

## Project structure

```
public/            Static frontend (HTML/CSS/JS)
api/ably_token.py  Token-issuing endpoint (Flask, Vercel Python function)
requirements.txt   Python dependencies
vercel.json        Routing/build configuration
```

Note: the token endpoint is named `ably_token.py` rather than `token.py`
to avoid a naming collision with Python's standard library `token` module.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env
```

Set `ABLY_API_KEY` in `.env` with a key from your Ably account (Publish,
Subscribe, and Presence capabilities required).

### Creating an Ably API key

1. Sign up at ably.com 
2. Create a new app in the dashboard
3. Open the API Keys tab and copy the key
4. Paste it into `.env` as `ABLY_API_KEY`

## Local development

```bash
npm install -g vercel
vercel dev
```

The project combines static assets with a Python serverless function, so
`vercel dev` is required to run both together correctly. The first run
will prompt a login to a free Vercel account and link the project; this
only affects local tooling and does not deploy anything.

## Deployment

1. Push the repository to GitHub
2. Import the project in Vercel — it detects `public/` as static output
   and `api/ably_token.py` as a Python function via `vercel.json`
3. Set `ABLY_API_KEY` under Project Settings → Environment Variables
4. Deploy

## Room links

Visiting the site without a URL fragment presents a Create/Join screen.
Creating a room generates a random identifier (e.g. `#a1b2c3`); sharing
the resulting URL allows another user to join the same room. Rooms are
otherwise isolated from one another — anyone visiting the bare URL is
assigned a new, unrelated room.

## WebRTC / TURN

STUN alone is insufficient for reliable connections across restrictive
NATs, firewalls, and mobile networks. A public TURN server (Open Relay)
is configured as a fallback for when a direct peer-to-peer path cannot
be established. This is adequate for low-traffic use; for production
deployments at scale, a dedicated TURN provider (e.g. Twilio, or a
self-hosted coturn instance) is recommended.

## Privacy

No message content is transmitted to or stored by any server. Messages
travel directly between browsers over a WebRTC data channel. Ably only
handles connection-setup metadata (IP addresses, room identifiers)
required to establish that connection, governed by its own privacy
policy.
