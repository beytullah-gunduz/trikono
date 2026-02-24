/* ============================================================
   board.js – Board state, adjacency rules, placement validation
   ============================================================ */
(function () {
  'use strict';

  const { Tiles } = window.Triomino;

  /*
   * Corner indices for a placed tile:
   *   UP  : [0]=Top   [1]=BottomRight  [2]=BottomLeft
   *   DOWN: [0]=Bottom [1]=TopLeft      [2]=TopRight
   *
   * Neighbour definitions specify which corners must match.
   */
  const UP_NEIGHBORS = [
    { dr: 0, dc: -1, my: [0, 2], their: [2, 0] }, // left
    { dr: 0, dc: 1, my: [0, 1], their: [1, 0] }, // right
    { dr: 1, dc: 0, my: [2, 1], their: [1, 2] }, // bottom
  ];

  const DOWN_NEIGHBORS = [
    { dr: 0, dc: -1, my: [1, 0], their: [0, 1] }, // left
    { dr: 0, dc: 1, my: [2, 0], their: [0, 2] }, // right
    { dr: -1, dc: 0, my: [1, 2], their: [2, 1] }, // top
  ];

  class Board {
    constructor() {
      /** @type {Map<string, {values:number[], tileId:number, playerId:number}>} */
      this.cells = new Map();
    }

    /* ---- helpers ---- */

    static isUp(r, c) {
      return ((r + c) % 2 + 2) % 2 === 0;
    }

    static key(r, c) {
      return r + ',' + c;
    }

    get(r, c) {
      return this.cells.get(Board.key(r, c)) || null;
    }

    has(r, c) {
      return this.cells.has(Board.key(r, c));
    }

    place(r, c, values, tileId, playerId) {
      this.cells.set(Board.key(r, c), { values, tileId, playerId });
    }

    get size() {
      return this.cells.size;
    }

    /* ---- adjacency ---- */

    static neighborDefs(r, c) {
      return Board.isUp(r, c) ? UP_NEIGHBORS : DOWN_NEIGHBORS;
    }

    neighbors(r, c) {
      return Board.neighborDefs(r, c).map(n => ({
        row: r + n.dr,
        col: c + n.dc,
        my: n.my,
        their: n.their,
      }));
    }

    /* ---- validation ---- */

    /**
     * Check whether placing `values` at (r, c) is legal.
     * `values` must already be the oriented corner array.
     */
    isValid(r, c, values) {
      if (this.has(r, c)) return false;
      if (this.size === 0) return true; // first tile

      let adjacent = false;
      for (const n of this.neighbors(r, c)) {
        const tile = this.get(n.row, n.col);
        if (!tile) continue;
        adjacent = true;
        for (let i = 0; i < n.my.length; i++) {
          if (values[n.my[i]] !== tile.values[n.their[i]]) return false;
        }
      }
      return adjacent;
    }

    /**
     * Return every legal {row, col, rotation, values} for a given tile.
     */
    getValidPlacements(tileValues) {
      const out = [];
      if (this.size === 0) {
        const isUp = Board.isUp(0, 0);
        for (let r = 0; r < 3; r++) {
          const v = Tiles.getPlacedValues(tileValues, r, isUp);
          out.push({ row: 0, col: 0, rotation: r, values: v });
        }
        return out;
      }

      // Collect empty cells adjacent to placed tiles
      const candidates = new Set();
      for (const key of this.cells.keys()) {
        const [row, col] = key.split(',').map(Number);
        for (const n of this.neighbors(row, col)) {
          if (!this.has(n.row, n.col)) {
            candidates.add(Board.key(n.row, n.col));
          }
        }
      }

      for (const key of candidates) {
        const [row, col] = key.split(',').map(Number);
        const isUp = Board.isUp(row, col);
        for (let rot = 0; rot < 3; rot++) {
          const v = Tiles.getPlacedValues(tileValues, rot, isUp);
          if (this.isValid(row, col, v)) {
            out.push({ row, col, rotation: rot, values: v });
          }
        }
      }
      return out;
    }

    /** All empty cells adjacent to at least one placed tile. */
    getEmptyAdjacent() {
      const set = new Set();
      for (const key of this.cells.keys()) {
        const [row, col] = key.split(',').map(Number);
        for (const n of this.neighbors(row, col)) {
          if (!this.has(n.row, n.col)) set.add(Board.key(n.row, n.col));
        }
      }
      return [...set].map(k => {
        const [r, c] = k.split(',').map(Number);
        return { row: r, col: c };
      });
    }

    /* ---- scoring ---- */

    calcScore(values) {
      const sum = Tiles.tileSum(values);
      if (Tiles.isTriple(values)) {
        return values[0] === 0 ? 40 : sum + 10;
      }
      return sum;
    }

    /* ---- serialisation ---- */

    serialize() {
      const obj = {};
      for (const [k, v] of this.cells) obj[k] = v;
      return obj;
    }

    deserialize(obj) {
      this.cells.clear();
      for (const [k, v] of Object.entries(obj)) this.cells.set(k, v);
    }
  }

  window.Triomino.Board = Board;
})();
