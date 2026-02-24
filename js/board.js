/* ============================================================
   board.js – Board state, adjacency rules, placement validation
   ============================================================ */
(function () {
  'use strict';

  const { Tiles } = window.Trikono;

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

    /**
     * Full score for placing a tile at (r, c) with corner values.
     * Includes base value, triple bonus, bridge, and hexagon bonuses.
     */
    calcScore(r, c, values) {
      // Base score = sum of corner numbers
      let score = Tiles.tileSum(values);

    // Triple bonus (all 3 corners identical)
      if (Tiles.isTriple(values)) {
        score = values[0] === 0 ? 40 : score + 10;
      }

      // Bridge bonus (+40)
      if (this._isBridge(r, c)) score += 40;

      // Hexagon bonus (+50 / +60 / +70)
      const hex = this._countCompletedHexagons(r, c);
      if (hex === 1) score += 50;
      else if (hex === 2) score += 60;
      else if (hex >= 3) score += 70;

      return score;
    }

    /* ---- bonus detection helpers ---- */

    /**
     * Vertex coordinates (vx, vy) for each corner of a cell.
     * vx = x / halfS,  vy = y / H  in the vertex lattice.
     */
    _vertexCoords(r, c) {
      if (Board.isUp(r, c)) {
        return [
          { vx: c + 1, vy: r },       // Top  [0]
          { vx: c + 2, vy: r + 1 },   // BR   [1]
          { vx: c, vy: r + 1 },   // BL   [2]
        ];
      }
      return [
        { vx: c + 1, vy: r + 1 },   // Bot  [0]
        { vx: c, vy: r },       // TL   [1]
        { vx: c + 2, vy: r },       // TR   [2]
      ];
    }

    /**
     * The 6 triangle cells (row, col) surrounding a vertex (vx, vy).
     * Every interior vertex is shared by exactly 6 triangles
     * (3 UP + 3 DOWN).
     */
    _surroundingCells(vx, vy) {
      return [
        { r: vy, c: vx - 1 },   // UP  – Top  corner at vertex
        { r: vy - 1, c: vx - 2 },   // UP  – BR   corner at vertex
        { r: vy - 1, c: vx },       // UP  – BL   corner at vertex
        { r: vy - 1, c: vx - 1 },   // DOWN – Bot  corner at vertex
        { r: vy, c: vx },       // DOWN – TL   corner at vertex
        { r: vy, c: vx - 2 },   // DOWN – TR   corner at vertex
      ];
    }

    /** Are all 6 cells around vertex (vx, vy) filled? */
    _isHexagonComplete(vx, vy) {
      return this._surroundingCells(vx, vy)
        .every(cell => this.has(cell.r, cell.c));
    }

    /** Count hexagons newly completed by the tile at (r, c). */
    _countCompletedHexagons(r, c) {
      let n = 0;
      for (const v of this._vertexCoords(r, c)) {
        if (this._isHexagonComplete(v.vx, v.vy)) n++;
      }
      return n;
    }

    /**
     * Bridge (PONT): the placed tile has exactly 1 edge-neighbor
     * (empty space on both other sides) AND the vertex opposite
     * that edge is shared with at least one other existing tile.
     */
    _isBridge(r, c) {
      const nbs = this.neighbors(r, c);
      const occ = nbs.map(n => this.has(n.row, n.col));
      if (occ.filter(Boolean).length !== 1) return false;

      // Which vertex is opposite the single connected edge?
      //   UP  edges [left, right, bottom] → opposite vertex [BR(1), BL(2), Top(0)]
      //   DOWN edges [left, right, top]   → opposite vertex [TR(2), TL(1), Bot(0)]
      const connIdx = occ.indexOf(true);
      const oppMap = Board.isUp(r, c) ? [1, 2, 0] : [2, 1, 0];
      const oppVert = this._vertexCoords(r, c)[oppMap[connIdx]];

      // Does any OTHER tile share that vertex?
      return this._surroundingCells(oppVert.vx, oppVert.vy)
        .some(cell => !(cell.r === r && cell.c === c) && this.has(cell.r, cell.c));
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

  window.Trikono.Board = Board;
})();
