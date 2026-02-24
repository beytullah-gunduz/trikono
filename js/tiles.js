/* ============================================================
   tiles.js – Tile generation and utility functions
   ============================================================ */
(function () {
  'use strict';

  /**
   * Generate all 56 unique Triomino tiles.
   * Each tile has values [a, b, c] with a ≤ b ≤ c, 0–5.
   */
  function generateAll() {
    const tiles = [];
    let id = 0;
    for (let a = 0; a <= 5; a++) {
      for (let b = a; b <= 5; b++) {
        for (let c = b; c <= 5; c++) {
          tiles.push({ id: id++, values: [a, b, c] });
        }
      }
    }
    return tiles; // 56 tiles
  }

  /**
   * Return the effective corner values when placing a tile.
   *
   * UP  triangle corners: [Top, BottomRight, BottomLeft]  (clockwise)
   * DOWN triangle corners: [Bottom, TopLeft, TopRight]
   *
   * Going from UP → DOWN is a 180° in-plane rotation (not a flip),
   * which maps BR→TL and BL→TR.  The three cyclic rotations are
   * therefore identical for both orientations.
   *
   * @param {number[]} values   – canonical tile values [a, b, c]
   * @param {number}   rotation – 0, 1 or 2
   * @returns {number[]} placed corner values
   */
  function getPlacedValues(values, rotation) {
    const [a, b, c] = values;
    if (rotation === 0) return [a, b, c];
    if (rotation === 1) return [c, a, b];
    return [b, c, a]; // rotation === 2
  }

  /** Fisher-Yates shuffle (returns new array). */
  function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function tileSum(values) {
    return values[0] + values[1] + values[2];
  }

  function isTriple(values) {
    return values[0] === values[1] && values[1] === values[2];
  }

  // Expose
  window.Triomino = window.Triomino || {};
  window.Triomino.Tiles = {
    generateAll,
    getPlacedValues,
    shuffleArray,
    tileSum,
    isTriple,
  };
})();
