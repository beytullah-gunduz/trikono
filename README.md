# Trikono

A triangular tile-matching game for 2–4 players. Play online with friends (peer-to-peer, no server needed) or locally on the same device.

## How to play

- Each tile is a triangle with numbers 0–5 on its corners
- Place tiles so that shared edges have matching numbers
- Score = sum of the tile's numbers, plus bonuses for bridges (+40), hexagons (+50/60/70), and triples (+10)
- If you can't play, draw a tile (−5 pts). Still stuck? Pass (−10 pts)
- First player to empty their hand wins (+25 bonus)

## Online multiplayer

One player creates a game and shares the URL. Others open it and join — connections are peer-to-peer via WebRTC (PeerJS). No backend required.

## Run locally

Open `index.html` in your browser. That's it.

## Deploy

Works on any static host (GitHub Pages, Netlify, etc.). Just push and serve — no build step.
