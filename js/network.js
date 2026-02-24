/* ============================================================
   network.js – Peer-to-peer networking via PeerJS (WebRTC)
   ============================================================ */
(function () {
    'use strict';

    class Network {
        constructor() {
            /** @type {Peer|null} */
            this.peer = null;
            /** @type {Map<string, DataConnection>} */
            this.connections = new Map();
            this.isHost = false;
            /** @type {DataConnection|null} */
            this.hostConn = null;
            this.gameId = null;

            // Callbacks
            this.onMessage = null;           // (data, fromPeerId)
            this.onPeerConnected = null;     // (peerId)
            this.onPeerDisconnected = null;  // (peerId)
            this.onConnected = null;         // ()
            this.onError = null;             // (err)
        }

        /* ---- helpers ---- */

        _genId() {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let id = '';
            for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
            return id;
        }

        /* ---- host ---- */

        createGame() {
            this.gameId = this._genId();
            this.isHost = true;
            const peerId = 'triomino-' + this.gameId;

            return new Promise((resolve, reject) => {
                this.peer = new Peer(peerId, { debug: 0 });

                this.peer.on('open', () => {
                    this.peer.on('connection', conn => this._handleIncoming(conn));
                    resolve(this.gameId);
                });

                this.peer.on('error', err => {
                    if (err.type === 'unavailable-id') {
                        // Collision – retry with a new id
                        this.peer.destroy();
                        this.gameId = this._genId();
                        this.createGame().then(resolve).catch(reject);
                    } else {
                        if (this.onError) this.onError(err);
                        reject(err);
                    }
                });
            });
        }

        /* ---- client ---- */

        joinGame(gameId) {
            this.gameId = gameId.toUpperCase();
            this.isHost = false;

            return new Promise((resolve, reject) => {
                this.peer = new Peer(null, { debug: 0 });

                this.peer.on('open', () => {
                    const conn = this.peer.connect('triomino-' + this.gameId, { reliable: true });

                    conn.on('open', () => {
                        this.hostConn = conn;

                        conn.on('data', data => {
                            if (this.onMessage) this.onMessage(data, 'host');
                        });
                        conn.on('close', () => {
                            if (this.onPeerDisconnected) this.onPeerDisconnected('host');
                        });

                        if (this.onConnected) this.onConnected();
                        resolve();
                    });

                    conn.on('error', err => {
                        if (this.onError) this.onError(err);
                        reject(err);
                    });
                });

                this.peer.on('error', err => {
                    if (this.onError) this.onError(err);
                    reject(err);
                });
            });
        }

        /* ---- connection handling ---- */

        _handleIncoming(conn) {
            conn.on('open', () => {
                this.connections.set(conn.peer, conn);

                conn.on('data', data => {
                    if (this.onMessage) this.onMessage(data, conn.peer);
                });

                conn.on('close', () => {
                    this.connections.delete(conn.peer);
                    if (this.onPeerDisconnected) this.onPeerDisconnected(conn.peer);
                });

                if (this.onPeerConnected) this.onPeerConnected(conn.peer);
            });
        }

        /* ---- messaging ---- */

        sendToHost(data) {
            if (this.hostConn && this.hostConn.open) this.hostConn.send(data);
        }

        sendToPeer(peerId, data) {
            const c = this.connections.get(peerId);
            if (c && c.open) c.send(data);
        }

        broadcast(data) {
            for (const c of this.connections.values()) {
                if (c.open) c.send(data);
            }
        }

        /* ---- utility ---- */

        getShareUrl() {
            const u = new URL(window.location.href.split('#')[0]);
            u.hash = this.gameId;
            return u.toString();
        }

        destroy() {
            if (this.peer) this.peer.destroy();
            this.peer = null;
            this.connections.clear();
            this.hostConn = null;
        }
    }

    window.Triomino.Network = Network;
})();
