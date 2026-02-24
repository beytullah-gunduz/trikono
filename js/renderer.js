/* ============================================================
   renderer.js – Canvas rendering for the triangular board
   ============================================================ */
(function () {
  'use strict';

  const Board = window.Trikono.Board;

  const PLAYER_COLORS = [
    { base: '#4361ee', light: '#5e7cf7', dark: '#2b44c0' },
    { base: '#ef233c', light: '#f25668', dark: '#c0162b' },
    { base: '#2dc653', light: '#52d975', dark: '#1a9e3b' },
    { base: '#ff9500', light: '#ffb040', dark: '#cc7700' },
  ];

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');

      // Tile geometry
      this.S = 90;                       // side length
      this.halfS = this.S / 2;
      this.H = this.S * Math.sqrt(3) / 2; // triangle height

      // View transform
      this.panX = 0;
      this.panY = 0;
      this.zoom = 1.0;

      // Interaction state
      this._dragging = false;
      this._dragMoved = false;
      this._lastX = 0;
      this._lastY = 0;
      this._pinchDist = 0;

      // Callbacks
      this.onCellClick = null;  // (row, col)
      this.onCellHover = null;  // (row, col | null)

      this._hoverCell = null;

      this._setupMouse();
      this._setupTouch();
      this.resize();

      window.addEventListener('resize', () => this.resize());
    }

    /* ================================================================
       Geometry helpers
       ================================================================ */

    /** Vertices of the triangle at grid (r,c) in board-pixel space. */
    getVertices(r, c) {
      const isUp = Board.isUp(r, c);
      const cx = (c + 1) * this.halfS;
      if (isUp) {
        return [
          { x: cx, y: r * this.H },                         // Top [0]
          { x: cx + this.halfS, y: (r + 1) * this.H },      // BR  [1]
          { x: cx - this.halfS, y: (r + 1) * this.H },      // BL  [2]
        ];
      }
      return [
        { x: cx, y: (r + 1) * this.H },                       // Bot [0]
        { x: cx - this.halfS, y: r * this.H },                // TL  [1]
        { x: cx + this.halfS, y: r * this.H },                // TR  [2]
      ];
    }

    /** Positions for the corner numbers (offset towards centroid). */
    getNumberPos(r, c) {
      const v = this.getVertices(r, c);
      const cx = (v[0].x + v[1].x + v[2].x) / 3;
      const cy = (v[0].y + v[1].y + v[2].y) / 3;
      return v.map(p => ({
        x: cx + (p.x - cx) * 0.60,
        y: cy + (p.y - cy) * 0.60,
      }));
    }

    /** Board-pixel → screen-pixel. */
    toScreen(bx, by) {
      const cw = this.canvas.width / window.devicePixelRatio;
      const ch = this.canvas.height / window.devicePixelRatio;
      return {
        x: bx * this.zoom + this.panX + cw / 2,
        y: by * this.zoom + this.panY + ch / 2,
      };
    }

    /** Screen-pixel → board-pixel. */
    fromScreen(sx, sy) {
      const cw = this.canvas.width / window.devicePixelRatio;
      const ch = this.canvas.height / window.devicePixelRatio;
      return {
        x: (sx - this.panX - cw / 2) / this.zoom,
        y: (sy - this.panY - ch / 2) / this.zoom,
      };
    }

    /** Barycentric point-in-triangle test. */
    _pit(px, py, v0, v1, v2) {
      const d1 = (px - v1.x) * (v0.y - v1.y) - (v0.x - v1.x) * (py - v1.y);
      const d2 = (px - v2.x) * (v1.y - v2.y) - (v1.x - v2.x) * (py - v2.y);
      const d3 = (px - v0.x) * (v2.y - v0.y) - (v2.x - v0.x) * (py - v0.y);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    }

    /** Determine which grid cell contains a screen-pixel position. */
    screenToGrid(sx, sy) {
      const { x: bx, y: by } = this.fromScreen(sx, sy);
      const ar = by / this.H;
      const ac = bx / this.halfS - 1;
      const r0 = Math.floor(ar);
      const c0 = Math.floor(ac);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const r = r0 + dr, c = c0 + dc;
          const v = this.getVertices(r, c);
          if (this._pit(bx, by, v[0], v[1], v[2])) return { row: r, col: c };
        }
      }
      return null;
    }

    /* ================================================================
       Drawing helpers
       ================================================================ */

    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.canvas.style.width = rect.width + 'px';
      this.canvas.style.height = rect.height + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    clear() {
      const ctx = this.ctx;
      const cw = this.canvas.width / window.devicePixelRatio;
      const ch = this.canvas.height / window.devicePixelRatio;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.restore();
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, cw, ch);
    }

    /** Draw a filled tile on the board. */
    drawTile(r, c, values, playerId, opts = {}) {
      const ctx = this.ctx;
      const verts = this.getVertices(r, c);
      const nums = this.getNumberPos(r, c);
      const sv = verts.map(v => this.toScreen(v.x, v.y));
      const sn = nums.map(v => this.toScreen(v.x, v.y));
      const col = PLAYER_COLORS[playerId % PLAYER_COLORS.length];

      ctx.save();
      ctx.globalAlpha = opts.alpha !== undefined ? opts.alpha : 1;

      // Shadow
      if (!opts.noShadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 6 * this.zoom;
        ctx.shadowOffsetX = 2 * this.zoom;
        ctx.shadowOffsetY = 2 * this.zoom;
      }

      // Fill
      ctx.beginPath();
      ctx.moveTo(sv[0].x, sv[0].y);
      ctx.lineTo(sv[1].x, sv[1].y);
      ctx.lineTo(sv[2].x, sv[2].y);
      ctx.closePath();

      const g = ctx.createLinearGradient(sv[0].x, sv[0].y, sv[1].x, sv[1].y);
      g.addColorStop(0, col.light);
      g.addColorStop(1, col.base);
      ctx.fillStyle = g;
      ctx.fill();

      // Reset shadow for border
      ctx.shadowColor = 'transparent';

      // Border
      ctx.strokeStyle = opts.highlight ? '#ffd166' : col.dark;
      ctx.lineWidth = opts.highlight ? 3.5 : 2;
      ctx.stroke();

      // Numbers
      const fontSize = Math.max(12, Math.round(20 * this.zoom));
      ctx.font = `bold ${fontSize}px "SF Mono", "Cascadia Code", Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < 3; i++) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeText(String(values[i]), sn[i].x, sn[i].y);
        ctx.fillStyle = '#fff';
        ctx.fillText(String(values[i]), sn[i].x, sn[i].y);
      }

      ctx.restore();
    }

    /** Draw a dashed outline for an empty adjacent cell. */
    drawSlot(r, c, valid) {
      const ctx = this.ctx;
      const sv = this.getVertices(r, c).map(v => this.toScreen(v.x, v.y));

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sv[0].x, sv[0].y);
      ctx.lineTo(sv[1].x, sv[1].y);
      ctx.lineTo(sv[2].x, sv[2].y);
      ctx.closePath();

      if (valid) {
        ctx.fillStyle = 'rgba(45, 198, 83, 0.15)';
        ctx.fill();
        ctx.setLineDash([7, 5]);
        ctx.strokeStyle = '#2dc653';
        ctx.lineWidth = 2.5;
      } else {
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
      }
      ctx.stroke();
      ctx.restore();
    }

    /** Semi-transparent ghost tile for placement preview. */
    drawGhost(r, c, values, playerId) {
      this.drawTile(r, c, values, playerId, { alpha: 0.55, highlight: true, noShadow: true });
    }

    /** Centre the view on a board-pixel coordinate. */
    centerOn(bx, by) {
      this.panX = -bx * this.zoom;
      this.panY = -by * this.zoom;
    }

    /** Centre on the centroid of placed tiles. */
    centerOnBoard(board) {
      if (board.size === 0) { this.panX = 0; this.panY = 0; return; }
      let sx = 0, sy = 0, n = 0;
      for (const key of board.cells.keys()) {
        const [r, c] = key.split(',').map(Number);
        const v = this.getVertices(r, c);
        sx += (v[0].x + v[1].x + v[2].x) / 3;
        sy += (v[0].y + v[1].y + v[2].y) / 3;
        n++;
      }
      this.centerOn(sx / n, sy / n);
    }

    /* ================================================================
       Input handling
       ================================================================ */

    _canvasXY(e) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    _setupMouse() {
      this.canvas.addEventListener('mousedown', e => {
        this._dragging = true;
        this._dragMoved = false;
        this._lastX = e.clientX;
        this._lastY = e.clientY;
      });

      window.addEventListener('mousemove', e => {
        if (this._dragging) {
          const dx = e.clientX - this._lastX;
          const dy = e.clientY - this._lastY;
          if (Math.abs(dx) + Math.abs(dy) > 3) this._dragMoved = true;
          this.panX += dx;
          this.panY += dy;
          this._lastX = e.clientX;
          this._lastY = e.clientY;
        }

        const { x, y } = this._canvasXY(e);
        const cell = this.screenToGrid(x, y);
        const prev = this._hoverCell;
        this._hoverCell = cell;
        if (this.onCellHover) {
          const changed = (!cell && prev) || (cell && !prev) ||
            (cell && prev && (cell.row !== prev.row || cell.col !== prev.col));
          if (changed) this.onCellHover(cell);
        }
      });

      window.addEventListener('mouseup', e => {
        if (this._dragging && !this._dragMoved) {
          const { x, y } = this._canvasXY(e);
          const cell = this.screenToGrid(x, y);
          if (cell && this.onCellClick) this.onCellClick(cell.row, cell.col);
        }
        this._dragging = false;
      });

      this.canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const { x: mx, y: my } = this._canvasXY(e);
        const old = this.zoom;
        const factor = e.deltaY > 0 ? 0.92 : 1.08;
        this.zoom = Math.max(0.25, Math.min(3.5, this.zoom * factor));
        const cw = this.canvas.width / window.devicePixelRatio;
        const ch = this.canvas.height / window.devicePixelRatio;
        this.panX = mx - (mx - this.panX) * (this.zoom / old);
        this.panY = my - (my - this.panY) * (this.zoom / old);
      }, { passive: false });

      // Prevent context menu on canvas
      this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    }

    _setupTouch() {
      let lastTouches = null;

      this.canvas.addEventListener('touchstart', e => {
        e.preventDefault();
        if (e.touches.length === 1) {
          this._dragging = true;
          this._dragMoved = false;
          this._lastX = e.touches[0].clientX;
          this._lastY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
          this._dragging = false;
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          this._pinchDist = Math.sqrt(dx * dx + dy * dy);
        }
        lastTouches = e.touches;
      }, { passive: false });

      this.canvas.addEventListener('touchmove', e => {
        e.preventDefault();
        if (e.touches.length === 1 && this._dragging) {
          const dx = e.touches[0].clientX - this._lastX;
          const dy = e.touches[0].clientY - this._lastY;
          if (Math.abs(dx) + Math.abs(dy) > 3) this._dragMoved = true;
          this.panX += dx;
          this.panY += dy;
          this._lastX = e.touches[0].clientX;
          this._lastY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (this._pinchDist > 0) {
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            const rect = this.canvas.getBoundingClientRect();
            const mx = midX - rect.left;
            const my = midY - rect.top;
            const old = this.zoom;
            this.zoom = Math.max(0.25, Math.min(3.5, this.zoom * (dist / this._pinchDist)));
            this.panX = mx - (mx - this.panX) * (this.zoom / old);
            this.panY = my - (my - this.panY) * (this.zoom / old);
          }
          this._pinchDist = dist;
        }
        lastTouches = e.touches;
      }, { passive: false });

      this.canvas.addEventListener('touchend', e => {
        if (e.touches.length === 0 && !this._dragMoved && lastTouches && lastTouches.length === 1) {
          const rect = this.canvas.getBoundingClientRect();
          const x = lastTouches[0].clientX - rect.left;
          const y = lastTouches[0].clientY - rect.top;
          const cell = this.screenToGrid(x, y);
          if (cell && this.onCellClick) this.onCellClick(cell.row, cell.col);
        }
        this._dragging = false;
        this._pinchDist = 0;
        lastTouches = null;
      });
    }
  }

  window.Trikono.Renderer = Renderer;
})();
