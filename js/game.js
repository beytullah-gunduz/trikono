/* ============================================================
   game.js – Game state machine, turns, scoring, rules
   ============================================================ */
(function () {
    'use strict';

    const { Tiles } = window.Triomino;
    const Board = window.Triomino.Board;

    class Game {
        constructor() {
            this.board = new Board();
            this.players = [];     // {id, name, tiles:[], score:0}
            this.pool = [];
            this.currentPlayerIndex = 0;
            this.phase = 'waiting'; // waiting | playing | finished
            this.drawnThisTurn = false;
            this.winner = -1;
            this.lastAction = null;
        }

        /* ---- player management ---- */

        addPlayer(id, name) {
            this.players.push({ id, name, tiles: [], score: 0 });
            return this.players.length - 1;
        }

        removePlayer(id) {
            const idx = this.players.findIndex(p => p.id === id);
            if (idx !== -1) this.players.splice(idx, 1);
        }

        /* ---- game lifecycle ---- */

        start() {
            const all = Tiles.generateAll();
            this.pool = Tiles.shuffleArray(all);

            const perPlayer = this.players.length <= 2 ? 9 : 7;
            for (const p of this.players) {
                p.tiles = this.pool.splice(0, perPlayer);
                p.score = 0;
            }

            this.currentPlayerIndex = this._findStarter();
            this.phase = 'playing';
            this.drawnThisTurn = false;
            this.winner = -1;
        }

        _findStarter() {
            let best = 0, bestVal = -1, bestTriple = false;
            for (let i = 0; i < this.players.length; i++) {
                for (const t of this.players[i].tiles) {
                    const s = Tiles.tileSum(t.values);
                    const trip = Tiles.isTriple(t.values);
                    if ((trip && !bestTriple) || (trip === bestTriple && s > bestVal)) {
                        best = i; bestVal = s; bestTriple = trip;
                    }
                }
            }
            return best;
        }

        currentPlayer() {
            return this.players[this.currentPlayerIndex];
        }

        /* ---- actions ---- */

        /**
         * Place tile from a player's hand onto the board.
         * Returns {success, error?, score?, gameOver?, winner?}
         */
        placeTile(playerIdx, tileIdx, row, col, rotation) {
            if (this.phase !== 'playing')
                return { success: false, error: 'Game is not in progress.' };
            if (playerIdx !== this.currentPlayerIndex)
                return { success: false, error: 'Not your turn.' };

            const player = this.players[playerIdx];
            if (tileIdx < 0 || tileIdx >= player.tiles.length)
                return { success: false, error: 'Invalid tile.' };

            const tile = player.tiles[tileIdx];
            const isUp = Board.isUp(row, col);
            const values = Tiles.getPlacedValues(tile.values, rotation, isUp);

            if (!this.board.isValid(row, col, values))
                return { success: false, error: 'Invalid placement.' };

            this.board.place(row, col, values, tile.id, playerIdx);

            const score = this.board.calcScore(values);
            player.score += score;
            player.tiles.splice(tileIdx, 1);

            this.lastAction = { type: 'place', player: playerIdx, row, col };

            if (player.tiles.length === 0) {
                player.score += 25;
                for (const other of this.players) {
                    if (other !== player)
                        for (const t of other.tiles) player.score += Tiles.tileSum(t.values);
                }
                this.phase = 'finished';
                this.winner = playerIdx;
                return { success: true, score, gameOver: true, winner: playerIdx };
            }

            this._nextTurn();
            return { success: true, score };
        }

        /**
         * Draw a tile from the pool.
         */
        drawTile(playerIdx) {
            if (this.phase !== 'playing')
                return { success: false, error: 'Game is not in progress.' };
            if (playerIdx !== this.currentPlayerIndex)
                return { success: false, error: 'Not your turn.' };
            if (this.pool.length === 0)
                return { success: false, error: 'Pool is empty.' };

            const tile = this.pool.pop();
            this.players[playerIdx].tiles.push(tile);
            this.players[playerIdx].score = Math.max(0, this.players[playerIdx].score - 5);
            this.drawnThisTurn = true;
            this.lastAction = { type: 'draw', player: playerIdx };

            return { success: true, tile, poolSize: this.pool.length };
        }

        /**
         * Pass turn (only when pool is empty and player cannot play).
         */
        passTurn(playerIdx) {
            if (this.phase !== 'playing')
                return { success: false, error: 'Game is not in progress.' };
            if (playerIdx !== this.currentPlayerIndex)
                return { success: false, error: 'Not your turn.' };
            if (!this.drawnThisTurn && this.pool.length > 0)
                return { success: false, error: 'Draw a tile first.' };
            if (this.canPlay(playerIdx))
                return { success: false, error: 'You have valid placements — play a tile!' };

            this.players[playerIdx].score = Math.max(0, this.players[playerIdx].score - 10);
            this.lastAction = { type: 'pass', player: playerIdx };
            this._nextTurn();

            if (this._isStalemate()) {
                this.phase = 'finished';
                this.winner = this._bestPlayer();
                return { success: true, gameOver: true, winner: this.winner };
            }
            return { success: true };
        }

        _nextTurn() {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
            this.drawnThisTurn = false;
        }

        /** Can any player play any tile? */
        _isStalemate() {
            if (this.pool.length > 0) return false;
            for (const p of this.players)
                for (const t of p.tiles)
                    if (this.board.getValidPlacements(t.values).length > 0) return false;
            return true;
        }

        _bestPlayer() {
            let best = 0;
            for (let i = 1; i < this.players.length; i++)
                if (this.players[i].score > this.players[best].score) best = i;
            return best;
        }

        /** Can the specified player place any of their tiles? */
        canPlay(playerIdx) {
            const p = this.players[playerIdx];
            if (!p) return false;
            for (const t of p.tiles)
                if (this.board.getValidPlacements(t.values).length > 0) return true;
            return false;
        }

        /* ---- serialisation ---- */

        /** State visible to a particular player (hides other hands). */
        serializeForPlayer(playerIdx) {
            return {
                board: this.board.serialize(),
                players: this.players.map((p, i) => ({
                    id: p.id, name: p.name, tileCount: p.tiles.length, score: p.score,
                })),
                currentPlayerIndex: this.currentPlayerIndex,
                phase: this.phase,
                poolSize: this.pool.length,
                winner: this.winner,
                drawnThisTurn: this.drawnThisTurn,
                lastAction: this.lastAction,
                yourIndex: playerIdx,
                yourTiles: this.players[playerIdx] ? this.players[playerIdx].tiles : [],
            };
        }

        /** Full state for saving / host transfer. */
        serializeFull() {
            return {
                board: this.board.serialize(),
                players: this.players.map(p => ({
                    id: p.id, name: p.name,
                    tiles: p.tiles.map(t => ({ ...t })),
                    score: p.score,
                })),
                pool: this.pool.map(t => ({ ...t })),
                currentPlayerIndex: this.currentPlayerIndex,
                phase: this.phase,
                winner: this.winner,
                drawnThisTurn: this.drawnThisTurn,
                lastAction: this.lastAction,
            };
        }

        /** Load full state. */
        loadFull(data) {
            this.board = new Board();
            this.board.deserialize(data.board);
            this.players = data.players;
            this.pool = data.pool;
            this.currentPlayerIndex = data.currentPlayerIndex;
            this.phase = data.phase;
            this.winner = data.winner;
            this.drawnThisTurn = data.drawnThisTurn || false;
            this.lastAction = data.lastAction;
        }
    }

    window.Triomino.Game = Game;
})();
