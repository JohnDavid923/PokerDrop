# The Poker Drop

A poker merchandise store implementing the final proposal from “Draft project proposal submission.” Visitors browse six products, reserve shared stock in a private cart, and complete a simulated checkout. No account, payment, or personal information is required.

## Run locally

Use Node.js 22.13 or newer and pnpm 11:

```sh
pnpm install --frozen-lockfile
pnpm start
```

Open http://localhost:3000. `PORT` overrides the port. With npm installed, `npm install` and `npm start` also work.

## Acceptance criteria

1. **WebSockets:** Socket.IO is configured with `transports: ['websocket']` on both client and server. It does not fall back to HTTP polling.
2. **10+ simultaneous visitors:** All connections share one authoritative inventory. The integration suite connects 12 real WebSocket clients, races them for the last five chip sets, and verifies identical updates on every client. Only five reservations succeed.
3. **Public URL without authentication:** The running app can be exposed through the included public tunnel instructions, or deployed as a Render Node web service. Neither path adds an application login.

## Shared state and reservations

- Adding an item immediately reserves one unit and broadcasts availability and activity to everyone.
- Each cart has a fixed five-minute reservation window from its first item. Adding more items does not extend it.
- Removing an item, disconnecting, refreshing, or expiration releases reserved units. The UI explains this behavior.
- Checkout calculates totals on the server and converts reserved units into completed demo purchases. Repeating checkout on an empty cart fails.
- Server-side handlers serialize stock checks and changes in a single Node process, preventing overselling.
- Completed purchase counts are atomically saved to `data/inventory.json`. Reservations are intentionally transient.
- No customer data, payment details, or order histories are stored. Other shoppers see generic activity only.

## Verify

```sh
pnpm test
```

The tests cover 12 simultaneous WebSocket clients, competing reservations, sold-out rejection, shared synchronization, release, expiration, disconnect, invalid requests, duplicate checkout, server-calculated totals, and persisted purchases. Test servers use isolated temporary state, not the running demo inventory.

To demonstrate it manually, open the public URL on two devices. Add an item on one and watch the available count change on the other. Remove it and watch the count recover. Checkout shows an explicitly simulated order confirmation.

## Public demo from this computer

Current demo: https://designs-specific-boating-harold.trycloudflare.com

Verified with an unauthenticated HTTP request and 12 simultaneous WebSocket clients. All 12 observed the same reservation and release updates. Repeat that check with `node test/public-smoke.js <public-url>` while merchandise is available. The smoke test releases its reservation and does not complete a purchase.

With the app running, use the official Cloudflare `cloudflared` executable:

```sh
cloudflared tunnel --url http://127.0.0.1:3000 --no-autoupdate
```

Share the HTTPS `trycloudflare.com` URL printed by the command. It requires no authentication. This is a temporary development URL: the computer must remain awake and connected, and both Node and the tunnel must keep running. Restarting the tunnel gives a different URL. The `.runtime/` directory contains the local demo executable and logs and is excluded from Git.

## Render deployment

`render.yaml` provides a single-instance free Node service configuration. Push this source to your GitHub repository and create a Render Blueprint from it, or create a Web Service with:

- Build: `npx --yes pnpm@11.25.0 install --frozen-lockfile`
- Start: `npm start`
- Health check: `/health`
- Node: 22 or newer

Render supplies `PORT` and an HTTPS `onrender.com` URL with WebSocket support. Use one instance. Sharing state across multiple instances would require a shared database and Socket.IO adapter.

The free Render filesystem is ephemeral, so completed demo purchases reset after a redeploy or instance replacement. Use a persistent disk on a compatible paid service or a database if permanent inventory is needed. Local purchases persist across application restarts on this computer. This is a classroom simulation, not a real commerce system.

## Files

- `server.js`: Express static serving, Socket.IO, inventory validation, reservation lifecycle, and persistence.
- `public/`: responsive storefront, original SVG product illustrations, cart, live feed, and confirmation dialog.
- `test/store.test.js`: integration tests using actual WebSocket connections.
- `render.yaml`: deployment configuration.

Documentation: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/), [Render Node services](https://render.com/docs/deploy-node-express-app), [Render WebSockets](https://render.com/docs/websocket).
