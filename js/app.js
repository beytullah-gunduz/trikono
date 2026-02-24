/* ============================================================
   app.js – Main application controller (UI, game loop, networking)
   ============================================================ */
(function () {
    'use strict';

    const { Tiles, Board, Renderer, Game, Network } = window.Trikono;

    class App {
        constructor() {
            this.renderer = null;
            this.game = null;
            this.network = null;

            // Mode: 'local' | 'host' | 'client'
            this.mode = null;
            this.myIndex = -1;          // index in players array
            this.myPeerId = null;

            // Client-side view state (populated from host broadcasts)
            this.viewState = null;

            // Interaction
            this.selectedTileIdx = -1;
            this.validPlacements = null;  // Map<"r,c", [{rotation, values}]>
            this.hoverCell = null;
            this.rotationOffset = 0;      // cycles through valid rotations at hover

            // Player registry for host
            this.peerToPlayer = new Map(); // peerId -> playerIndex
            this.localPlayerCount = 2;

            this._raf = null;
        }

        /* ================================================================
           Initialisation
           ================================================================ */

        init() {
            this._cacheDOM();
            this._bindHome();
            this._bindLobby();
            this._bindGame();

            // Check URL hash for auto-join
            const hash = location.hash.replace('#', '').trim();
            if (hash) {
                this.els.gameCode.value = hash;
                this._showScreen('home');
            } else {
                this._showScreen('home');
            }
        }

        _cacheDOM() {
            const $ = id => document.getElementById(id);
            this.els = {
                // Screens
                homeScreen: $('home-screen'),
                lobbyScreen: $('lobby-screen'),
                gameScreen: $('game-screen'),
                // Home
                playerName: $('player-name'),
                createBtn: $('create-btn'),
                joinBtn: $('join-btn'),
                localBtn: $('local-btn'),
                gameCode: $('game-code'),
                homeError: $('home-error'),
                // Lobby
                lobbyTitle: $('lobby-title'),
                shareBox: $('share-box'),
                shareUrl: $('share-url'),
                copyBtn: $('copy-btn'),
                playerList: $('player-list'),
                startBtn: $('start-btn'),
                lobbyStatus: $('lobby-status'),
                localSetup: $('local-setup'),
                localCount: $('local-count'),
                localNames: $('local-names'),
                // Game
                boardCanvas: $('board-canvas'),
                handContainer: $('hand-tiles'),
                drawBtn: $('draw-btn'),
                passBtn: $('pass-btn'),
                rotateBtn: $('rotate-btn'),
                turnInfo: $('turn-info'),
                poolInfo: $('pool-info'),
                scoreBoard: $('score-board'),
                notification: $('notification'),
                gameOverOverlay: $('game-over'),
                gameOverText: $('game-over-text'),
                gameOverScores: $('game-over-scores'),
                newGameBtn: $('new-game-btn'),
            };
        }

        _showScreen(name) {
            for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
            document.getElementById(name + '-screen').classList.remove('hidden');
            if (name === 'game') {
                this._initRenderer();
                this._startLoop();
            }
        }

        /* ================================================================
           Home screen
           ================================================================ */

        _bindHome() {
            this.els.createBtn.addEventListener('click', () => this._createOnline());
            this.els.joinBtn.addEventListener('click', () => this._joinOnline());
            this.els.localBtn.addEventListener('click', () => this._setupLocal());
            this.els.playerName.addEventListener('keydown', e => { if (e.key === 'Enter') this._joinOnline(); });
            this.els.gameCode.addEventListener('keydown', e => { if (e.key === 'Enter') this._joinOnline(); });
        }

        async _createOnline() {
            const name = this.els.playerName.value.trim() || 'Player 1';
            this.mode = 'host';
            this.network = new Network();
            this.game = new Game();

            try {
                this.els.createBtn.disabled = true;
                this.els.createBtn.textContent = 'Connecting…';
                const gameId = await this.network.createGame();
                this.myIndex = this.game.addPlayer('host', name);
                this.peerToPlayer.set('host', 0);

                // Network callbacks
                this.network.onPeerConnected = peerId => this._hostOnPeerConnected(peerId);
                this.network.onMessage = (data, from) => this._hostOnMessage(data, from);
                this.network.onPeerDisconnected = peerId => this._hostOnPeerDisconnected(peerId);
                this.network.onError = err => this._notify('Connection error: ' + err.type, true);

                this._showLobbyOnline(gameId, name);
            } catch (e) {
                this.els.homeError.textContent = 'Failed to create game. Check your connection.';
                this.els.createBtn.disabled = false;
                this.els.createBtn.textContent = 'Create Online Game';
            }
        }

        async _joinOnline() {
            const name = this.els.playerName.value.trim() || 'Player';
            const code = this.els.gameCode.value.trim().toUpperCase();
            if (!code) { this.els.homeError.textContent = 'Enter a game code.'; return; }

            this.mode = 'client';
            this.network = new Network();

            try {
                this.els.joinBtn.disabled = true;
                this.els.joinBtn.textContent = 'Connecting…';
                await this.network.joinGame(code);

                this.network.onMessage = (data) => this._clientOnMessage(data);
                this.network.onPeerDisconnected = () => this._notify('Host disconnected!', true);
                this.network.onError = err => this._notify('Connection error: ' + err.type, true);

                // Send join request
                this.network.sendToHost({ type: 'join', name });
                this._showScreen('lobby');
                this.els.lobbyTitle.textContent = 'Joining game…';
                this.els.shareBox.classList.add('hidden');
                this.els.startBtn.classList.add('hidden');
                this.els.localSetup.classList.add('hidden');
            } catch (e) {
                this.els.homeError.textContent = 'Could not connect. Check the code and try again.';
                this.els.joinBtn.disabled = false;
                this.els.joinBtn.textContent = 'Join Game';
            }
        }

        _setupLocal() {
            this.mode = 'local';
            this.game = new Game();
            this._showScreen('lobby');
            this.els.lobbyTitle.textContent = 'Local Game Setup';
            this.els.shareBox.classList.add('hidden');
            this.els.playerList.innerHTML = '';
            this.els.startBtn.classList.remove('hidden');
            this.els.startBtn.disabled = false;
            this.els.localSetup.classList.remove('hidden');
            this.els.lobbyStatus.textContent = '';
            this._updateLocalNames();
            // Avoid duplicate listeners
            if (!this._localCountBound) {
                this._localCountBound = true;
                this.els.localCount.addEventListener('change', () => this._updateLocalNames());
            }
        }

        _updateLocalNames() {
            const n = parseInt(this.els.localCount.value) || 2;
            this.localPlayerCount = n;
            this.els.localNames.innerHTML = '';
            for (let i = 0; i < n; i++) {
                const inp = document.createElement('input');
                inp.type = 'text';
                inp.placeholder = `Player ${i + 1}`;
                inp.className = 'local-name-input';
                inp.value = `Player ${i + 1}`;
                this.els.localNames.appendChild(inp);
            }
        }

        /* ================================================================
           Lobby screen
           ================================================================ */

        _bindLobby() {
            this.els.startBtn.addEventListener('click', () => this._startGame());
            this.els.copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(this.els.shareUrl.value).then(() => {
                    this.els.copyBtn.textContent = 'Copied!';
                    setTimeout(() => this.els.copyBtn.textContent = 'Copy', 1500);
                });
            });
        }

        _showLobbyOnline(gameId, hostName) {
            this._showScreen('lobby');
            this.els.lobbyTitle.textContent = 'Game Lobby';
            this.els.shareBox.classList.remove('hidden');
            this.els.shareUrl.value = this.network.getShareUrl();
            this.els.localSetup.classList.add('hidden');
            this.els.startBtn.classList.remove('hidden');
            this.els.startBtn.disabled = true;
            this._renderPlayerList();
        }

        _renderPlayerList() {
            const ul = this.els.playerList;
            ul.innerHTML = '';
            const players = this.game ? this.game.players : [];
            for (const p of players) {
                const li = document.createElement('li');
                li.innerHTML = `<span class="dot"></span> ${this._esc(p.name)}`;
                if (p.id === 'host') li.innerHTML += ' <small>(host)</small>';
                ul.appendChild(li);
            }
            this.els.lobbyStatus.textContent = `${players.length} / 4 players`;
            if (this.mode === 'host') {
                this.els.startBtn.disabled = players.length < 2;
            }
        }

        /* ================================================================
           Host networking
           ================================================================ */

        _hostOnPeerConnected(peerId) {
            // Wait for their 'join' message
        }

        _hostOnMessage(data, from) {
            switch (data.type) {
                case 'join': {
                    if (this.game.players.length >= 4) {
                        this.network.sendToPeer(from, { type: 'error', message: 'Game is full.' });
                        return;
                    }
                    if (this.game.phase !== 'waiting') {
                        this.network.sendToPeer(from, { type: 'error', message: 'Game already started.' });
                        return;
                    }
                    const idx = this.game.addPlayer(from, data.name || 'Player');
                    this.peerToPlayer.set(from, idx);
                    this._renderPlayerList();
                    // Broadcast lobby update
                    this._broadcastLobby();
                    break;
                }
                case 'place': {
                    const pIdx = this.peerToPlayer.get(from);
                    if (pIdx === undefined) return;
                    const res = this.game.placeTile(pIdx, data.tileIndex, data.row, data.col, data.rotation);
                    if (!res.success) {
                        this.network.sendToPeer(from, { type: 'error', message: res.error });
                    }
                    this._broadcastState();
                    this._updateLocalGame();
                    break;
                }
                case 'draw': {
                    const pIdx = this.peerToPlayer.get(from);
                    if (pIdx === undefined) return;
                    this.game.drawTile(pIdx);
                    this._broadcastState();
                    this._updateLocalGame();
                    break;
                }
                case 'pass': {
                    const pIdx = this.peerToPlayer.get(from);
                    if (pIdx === undefined) return;
                    this.game.passTurn(pIdx);
                    this._broadcastState();
                    this._updateLocalGame();
                    break;
                }
            }
        }

        _hostOnPeerDisconnected(peerId) {
            const idx = this.peerToPlayer.get(peerId);
            if (idx !== undefined) {
                this._notify(`${this.game.players[idx].name} disconnected.`, true);
            }
        }

        _broadcastLobby() {
            const lobby = {
                type: 'lobby',
                players: this.game.players.map(p => ({ name: p.name, id: p.id })),
            };
            this.network.broadcast(lobby);
        }

        _broadcastState() {
            // Send personalised state to each remote player
            for (const [peerId, pIdx] of this.peerToPlayer) {
                if (peerId === 'host') continue;
                this.network.sendToPeer(peerId, {
                    type: 'state',
                    state: this.game.serializeForPlayer(pIdx),
                });
            }
        }

        /* ================================================================
           Client networking
           ================================================================ */

        _clientOnMessage(data) {
            switch (data.type) {
                case 'lobby': {
                    this.els.lobbyTitle.textContent = 'Game Lobby';
                    const ul = this.els.playerList;
                    ul.innerHTML = '';
                    for (const p of data.players) {
                        const li = document.createElement('li');
                        li.innerHTML = `<span class="dot"></span> ${this._esc(p.name)}`;
                        if (p.id === 'host') li.innerHTML += ' <small>(host)</small>';
                        ul.appendChild(li);
                    }
                    this.els.lobbyStatus.textContent = `${data.players.length} / 4 players`;
                    break;
                }
                case 'state': {
                    this.viewState = data.state;
                    this.myIndex = data.state.yourIndex;
                    if (this._raf === null) {
                        this._showScreen('game');
                    }
                    this._refreshFromView();
                    break;
                }
                case 'error': {
                    this._notify(data.message, true);
                    break;
                }
            }
        }

        /** Populate local board from viewState (for rendering). */
        _refreshFromView() {
            if (!this.viewState) return;
            const vs = this.viewState;

            // Rebuild board for rendering
            if (!this.game) this.game = new Game();
            this.game.board.deserialize(vs.board);
            this.game.currentPlayerIndex = vs.currentPlayerIndex;
            this.game.phase = vs.phase;
            this.game.winner = vs.winner;
            this.game.drawnThisTurn = vs.drawnThisTurn || false;
            this.game.lastAction = vs.lastAction;
            this.game.players = vs.players.map((p, i) => ({
                ...p, tiles: i === vs.yourIndex ? vs.yourTiles : [],
            }));
            // Pool size (for display)
            this.game.pool = new Array(vs.poolSize);

            this._updateUI();
            // Recalculate valid placements if tile is selected
            if (this.selectedTileIdx >= 0) this._computeValid();
        }

        /* ================================================================
           Start game
           ================================================================ */

        _startGame() {
            if (this.mode === 'local') {
                const inputs = this.els.localNames.querySelectorAll('input');
                inputs.forEach((inp, i) => {
                    this.game.addPlayer('local-' + i, inp.value.trim() || `Player ${i + 1}`);
                });
                this.myIndex = 0; // local controls all
                this.game.start();
                this._showScreen('game');
                this._updateLocalGame();
            } else if (this.mode === 'host') {
                if (this.game.players.length < 2) return;
                this.game.start();
                this._broadcastState();
                this._showScreen('game');
                this.viewState = this.game.serializeForPlayer(this.myIndex);
                this._updateLocalGame();
            }
        }

        _updateLocalGame() {
            if (this.mode === 'host' || this.mode === 'local') {
                this.viewState = this.game.serializeForPlayer(
                    this.mode === 'local' ? this.game.currentPlayerIndex : this.myIndex
                );
                this._updateUI();
                if (this.selectedTileIdx >= 0) this._computeValid();
            }
        }

        /* ================================================================
           Game screen – renderer & loop
           ================================================================ */

        _initRenderer() {
            if (this.renderer) return;
            this.renderer = new Renderer(this.els.boardCanvas);
            this.renderer.onCellClick = (r, c) => this._onBoardClick(r, c);
            this.renderer.onCellHover = cell => {
                this.hoverCell = cell;
                this.rotationOffset = 0;
            };

            // Ensure layout is settled, then resize and center
            requestAnimationFrame(() => {
                this.renderer.resize();
                if (this.game && this.game.board.size > 0)
                    this.renderer.centerOnBoard(this.game.board);
            });
        }

        _startLoop() {
            const loop = () => {
                this._render();
                this._raf = requestAnimationFrame(loop);
            };
            if (!this._raf) this._raf = requestAnimationFrame(loop);
        }

        _render() {
            if (!this.renderer || !this.game) return;
            const r = this.renderer;
            const board = this.game.board;

            r.clear();

            // Empty adjacent slots
            const empties = board.getEmptyAdjacent();
            const validKeys = this.validPlacements || new Map();
            for (const pos of empties) {
                const k = Board.key(pos.row, pos.col);
                r.drawSlot(pos.row, pos.col, validKeys.has(k));
            }
            // Show starting position when board is empty
            if (board.size === 0) {
                const valid = this.selectedTileIdx >= 0 && validKeys.has('0,0');
                r.drawSlot(0, 0, valid);
            }

            // Placed tiles
            for (const [key, tile] of board.cells) {
                const [row, col] = key.split(',').map(Number);
                r.drawTile(row, col, tile.values, tile.playerId);
            }

            // Hint text when board is empty
            if (board.size === 0 && this.selectedTileIdx < 0 && this.viewState && this.viewState.phase === 'playing') {
                const cw = r.canvas.width / window.devicePixelRatio;
                const ch = r.canvas.height / window.devicePixelRatio;
                r.ctx.save();
                r.ctx.font = '20px system-ui, sans-serif';
                r.ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
                r.ctx.textAlign = 'center';
                r.ctx.fillText('Select a tile from your hand to begin', cw / 2, ch / 2 - 20);
                r.ctx.restore();
            }

            // Ghost preview
            if (this.hoverCell && this.validPlacements) {
                const k = Board.key(this.hoverCell.row, this.hoverCell.col);
                const rots = this.validPlacements.get(k);
                if (rots && rots.length > 0) {
                    const idx = ((this.rotationOffset % rots.length) + rots.length) % rots.length;
                    const chosen = rots[idx];
                    const pid = this.mode === 'local' ? this.game.currentPlayerIndex : this.myIndex;
                    r.drawGhost(this.hoverCell.row, this.hoverCell.col, chosen.values, pid);
                }
            }
        }

        /* ================================================================
           Game UI
           ================================================================ */

        _bindGame() {
            this.els.rotateBtn.addEventListener('click', () => {
                this.rotationOffset++;
            });
            this.els.drawBtn.addEventListener('click', () => this._doDrawTile());
            this.els.passBtn.addEventListener('click', () => this._doPass());
            this.els.newGameBtn.addEventListener('click', () => location.reload());

            // Keyboard shortcuts
            document.addEventListener('keydown', e => {
                if (document.querySelector('.screen:not(.hidden)')?.id !== 'game-screen') return;
                if (e.key === 'r' || e.key === 'R') { this.rotationOffset++; }
                if (e.key === 'Escape') { this._deselectTile(); }
            });
        }

        _updateUI() {
            if (!this.viewState) return;
            const vs = this.viewState;
            const isMyTurn = this._isMyTurn();

            // Turn info
            const cp = vs.players[vs.currentPlayerIndex];
            if (vs.phase === 'playing') {
                if (this.mode === 'local') {
                    this.els.turnInfo.innerHTML = `<strong>${this._esc(cp.name)}</strong>'s turn`;
                } else {
                    this.els.turnInfo.innerHTML = isMyTurn
                        ? '<strong>Your turn!</strong>'
                        : `Waiting for <strong>${this._esc(cp.name)}</strong>…`;
                }
            } else if (vs.phase === 'finished') {
                this.els.turnInfo.innerHTML = '<strong>Game Over</strong>';
            }

            // Pool
            const poolSz = vs.poolSize !== undefined ? vs.poolSize : this.game.pool.length;
            this.els.poolInfo.textContent = `Pool: ${poolSz}`;

            // Scores
            this.els.scoreBoard.innerHTML = vs.players.map((p, i) => {
                const cls = i === vs.currentPlayerIndex ? 'active' : '';
                const col = ['#4361ee', '#ef233c', '#2dc653', '#ff9500'][i % 4];
                return `<div class="score-entry ${cls}" style="border-left:3px solid ${col}">
                    <span class="sname">${this._esc(p.name)}</span>
                    <span class="sval">${p.score}</span>
                    <span class="stiles">${p.tileCount} tiles</span>
                </div>`;
            }).join('');

            // Hand
            this._renderHand();

            // Buttons
            const drawn = vs.drawnThisTurn || false;
            this.els.drawBtn.disabled = !isMyTurn || poolSz === 0 || drawn;
            this.els.passBtn.disabled = !isMyTurn || (!drawn && poolSz > 0);
            this.els.rotateBtn.disabled = this.selectedTileIdx < 0;

            // Game over overlay
            if (vs.phase === 'finished') {
                this._showGameOver();
            }
        }

        _renderHand() {
            const container = this.els.handContainer;
            const tiles = this.viewState ? this.viewState.yourTiles : [];
            container.innerHTML = '';

            tiles.forEach((tile, idx) => {
                const div = document.createElement('div');
                div.className = 'hand-tile' + (idx === this.selectedTileIdx ? ' selected' : '');
                div.innerHTML = this._tileSVG(tile.values, idx === this.selectedTileIdx);
                div.addEventListener('click', () => this._selectTile(idx));
                container.appendChild(div);
            });
        }

        _tileSVG(values, selected) {
            const w = 80, h = 70;
            const pts = `${w / 2},3 ${w - 3},${h - 3} 3,${h - 3}`;
            const fill = selected ? '#ffd166' : '#374151';
            const stroke = selected ? '#f59e0b' : '#6b7280';
            // Number positions (Top, BR, BL for UP)
            const np = [
                { x: w / 2, y: 25 },
                { x: w - 17, y: h - 15 },
                { x: 17, y: h - 15 },
            ];
            return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
                <polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
                ${np.map((p, i) => `<text x="${p.x}" y="${p.y}" text-anchor="middle"
                    dominant-baseline="middle" fill="#fff" font-size="18"
                    font-weight="bold" font-family="monospace">${values[i]}</text>`).join('')}
            </svg>`;
        }

        /* ================================================================
           Game actions
           ================================================================ */

        _isMyTurn() {
            if (!this.viewState) return false;
            if (this.viewState.phase !== 'playing') return false;
            if (this.mode === 'local') return true;
            return this.viewState.currentPlayerIndex === this.myIndex;
        }

        _selectTile(idx) {
            if (!this._isMyTurn()) return;
            if (this.selectedTileIdx === idx) {
                this._deselectTile();
                return;
            }
            this.selectedTileIdx = idx;
            this.rotationOffset = 0;
            this._computeValid();
            this._renderHand();
            if (this.validPlacements && this.validPlacements.size === 0) {
                this._notify('No valid placement for this tile. Try another or draw.');
            }
        }

        _deselectTile() {
            this.selectedTileIdx = -1;
            this.validPlacements = null;
            this.rotationOffset = 0;
            this._renderHand();
        }

        _computeValid() {
            const tiles = this.viewState ? this.viewState.yourTiles : [];
            if (this.selectedTileIdx < 0 || this.selectedTileIdx >= tiles.length) {
                this.validPlacements = null;
                return;
            }
            const tile = tiles[this.selectedTileIdx];
            const placements = this.game.board.getValidPlacements(tile.values);
            const map = new Map();
            for (const p of placements) {
                const k = Board.key(p.row, p.col);
                if (!map.has(k)) map.set(k, []);
                map.get(k).push({ rotation: p.rotation, values: p.values });
            }
            this.validPlacements = map;
        }

        _onBoardClick(row, col) {
            if (!this._isMyTurn()) return;
            if (this.selectedTileIdx < 0) return;

            const k = Board.key(row, col);
            if (!this.validPlacements || !this.validPlacements.has(k)) return;

            const rots = this.validPlacements.get(k);
            const idx = ((this.rotationOffset % rots.length) + rots.length) % rots.length;
            const chosen = rots[idx];

            // Find the original tile
            const tiles = this.viewState.yourTiles;
            const tile = tiles[this.selectedTileIdx];

            if (this.mode === 'host' || this.mode === 'local') {
                const pIdx = this.mode === 'local' ? this.game.currentPlayerIndex : this.myIndex;
                // For local mode, selectedTileIdx is relative to the current player's hand
                const res = this.game.placeTile(pIdx, this.selectedTileIdx, row, col, chosen.rotation);
                if (res.success) {
                    if (res.score > 15) this._notify(`+${res.score} points!`);
                    this._deselectTile();
                    if (this.mode === 'host') this._broadcastState();
                    this._updateLocalGame();
                    this.renderer.centerOnBoard(this.game.board);
                } else {
                    this._notify(res.error, true);
                }
            } else {
                // Client: send to host
                this.network.sendToHost({
                    type: 'place',
                    tileIndex: this.selectedTileIdx,
                    row, col,
                    rotation: chosen.rotation,
                });
                this._deselectTile();
            }
        }

        _doDrawTile() {
            if (!this._isMyTurn()) return;
            if (this.mode === 'host' || this.mode === 'local') {
                const pIdx = this.mode === 'local' ? this.game.currentPlayerIndex : this.myIndex;
                const res = this.game.drawTile(pIdx);
                if (res.success) {
                    this._deselectTile();
                    if (this.mode === 'host') this._broadcastState();
                    this._updateLocalGame();
                    this._notify(`Drew a tile (−5 pts). Pool: ${this.game.pool.length}`);
                } else {
                    this._notify(res.error, true);
                }
            } else {
                this.network.sendToHost({ type: 'draw' });
            }
        }

        _doPass() {
            if (!this._isMyTurn()) return;
            if (this.mode === 'host' || this.mode === 'local') {
                const pIdx = this.mode === 'local' ? this.game.currentPlayerIndex : this.myIndex;
                const res = this.game.passTurn(pIdx);
                if (res.success) {
                    this._deselectTile();
                    if (this.mode === 'host') this._broadcastState();
                    this._updateLocalGame();
                } else {
                    this._notify(res.error, true);
                }
            } else {
                this.network.sendToHost({ type: 'pass' });
            }
        }

        /* ================================================================
           Game Over
           ================================================================ */

        _showGameOver() {
            const vs = this.viewState;
            if (!vs) return;
            const winner = vs.players[vs.winner];
            this.els.gameOverText.textContent = winner
                ? `${winner.name} wins!`
                : 'Game Over!';
            this.els.gameOverScores.innerHTML = vs.players
                .slice()
                .sort((a, b) => b.score - a.score)
                .map(p => `<div>${this._esc(p.name)}: <strong>${p.score}</strong> pts</div>`)
                .join('');
            this.els.gameOverOverlay.classList.remove('hidden');
        }

        /* ================================================================
           Helpers
           ================================================================ */

        _notify(msg, isError = false) {
            const el = this.els.notification;
            el.textContent = msg;
            el.className = 'notification show' + (isError ? ' error' : '');
            clearTimeout(this._notifyTimer);
            this._notifyTimer = setTimeout(() => el.className = 'notification', 3000);
        }

        _esc(str) {
            const d = document.createElement('div');
            d.textContent = str;
            return d.innerHTML;
        }
    }

    // Boot
    window.addEventListener('DOMContentLoaded', () => {
        const app = new App();
        app.init();
        window._trikonoApp = app; // debug access
    });
})();
