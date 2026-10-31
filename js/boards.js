// Board geometry in field spacings (one unit = distance between neighbouring fields),
// origin at the board centre, x to the right, y towards the player.

// ---- 4 colors: the classic cross on an 11x11 grid ----
function cross() {
  const g = (c, r) => [c - 5, r - 5];             // grid column/row -> centred units
  // 40 track fields clockwise from color 0's gate on the left arm: one quarter, rotated 4 times
  const quarter = [[0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [4, 3], [4, 2], [4, 1], [4, 0], [5, 0]];
  const track = [];
  for (let q = 0; q < 4; q++) {
    for (let [c, r] of quarter) {
      for (let k = 0; k < q; k++) [c, r] = [10 - r, c];
      track.push(g(c, r));
    }
  }
  const range4 = f => [0, 1, 2, 3].map(f);
  const home = [range4(k => g(1 + k, 5)), range4(k => g(5, 1 + k)), range4(k => g(9 - k, 5)), range4(k => g(5, 9 - k))];
  const yard = [[[0, 0], [1, 0], [0, 1], [1, 1]], [[9, 0], [10, 0], [9, 1], [10, 1]],
    [[9, 9], [10, 9], [9, 10], [10, 10]], [[0, 9], [1, 9], [0, 10], [1, 10]]].map(y => y.map(p => g(...p)));
  const label = [[-2.5, -4.5], [4.5, -2.5], [2.5, 4.5], [-4.5, 2.5]];
  const outline = [[-5.6, -5.6], [5.6, -5.6], [5.6, 5.6], [-5.6, 5.6]];
  // where the dice settle: a straight row in the free strip between each yard and the corridor
  // out of its gate, parallel to the corridor (at = its middle, dir = along the row). Found by a
  // search that keeps the row clear of every field and the yard pawns even at the largest die
  // size (max = the most a die may grow on a small screen); the names moved out of the way.
  const dice = [[[-4.04, -2.2], [1, 0]], [[2.2, -4.04], [0, 1]], [[4.04, 2.2], [-1, 0]], [[-2.2, 4.04], [0, -1]]]
    .map(([at, dir]) => ({ at, dir, size: 0.55, max: 1.6 }));
  return { track, home, yard, label, outline, dice };
}

// ---- 6 colors: six arms like the wooden 6-player board, 10 fields per corridor ----
// Per corridor: 4 fields on the arm's inbound row (gate first), one junction field at the
// inner corner, 4 on the next arm's outbound row and the tip of that arm.
// `arm` fields per row: 4 gives 10 fields per corridor, 6 gives 14 (longer arms, same star;
// the nests, yards, names and dice move out with the tips).
function star(arm = 4) {
  const ext = arm - 4;
  const out = ([x, y], by) => { const r = Math.hypot(x, y); return [x * (r + by) / r, y * (r + by) / r]; };
  const d1 = 2 + Math.sqrt(3);          // inner end of the rows: the junction is 1 field from both rows
  const rad = a => (a * Math.PI) / 180;
  const u = c => [Math.cos(rad(-150 + 60 * c)), Math.sin(rad(-150 + 60 * c))];
  const p = c => [Math.cos(rad(-60 + 60 * c)), Math.sin(rad(-60 + 60 * c))];
  const pt = (c, d, off) => {
    const [ux, uy] = u(c), [px, py] = p(c);
    return [ux * d + px * off, uy * d + py * off];
  };
  const track = [];
  for (let c = 0; c < 6; c++) {
    const n = (c + 1) % 6;
    for (let k = 0; k < arm; k++) track.push(pt(c, d1 + arm - 1 - k, 1));
    const a = pt(c, d1, 1), b = pt(n, d1, -1);
    track.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    for (let k = 0; k < arm; k++) track.push(pt(n, d1 + k, -1));
    track.push(pt(n, d1 + arm - 1, 0));
  }
  // track[10c] is color c's gate; track[10c + 9], the tip of arm c+1, is color c+1's threshold
  const home = [0, 1, 2, 3, 4, 5].map(c => [0, 1, 2, 3].map(k => pt(c, d1 + ext + 2 - k, 0)));
  const at = (c, r) => [Math.cos(rad(-120 + 60 * c)) * r, Math.sin(rad(-120 + 60 * c)) * r];
  const yard = [0, 1, 2, 3, 4, 5].map(c => {
    const [x, y] = at(c, 6.9 + ext);
    return [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]].map(([ox, oy]) => [x + ox, y + oy]);
  });
  const label = [[-2.15, -4.58], [2.75, -4.18], [5.05, 0.25], [2.15, 4.58], [-2.75, 4.18], [-5.05, -0.25]].map(p => out(p, ext));
  const outline = [0, 1, 2, 3, 4, 5].map(c => at(c, 8.7 + ext));
  // where the dice settle: as on the cross, a straight row between the yard and the corridor out
  // of the gate, parallel to it (the strip is narrower here, so the dice grow less)
  const dice = [[[-4.01, -4.54], [0.866, 0.5]], [[1.93, -6.18], [0, 1]], [[6.28, -1.46], [-0.866, 0.5]],
    [[4.01, 4.54], [-0.866, -0.5]], [[-1.93, 6.18], [0, -1]], [[-6.28, 1.46], [0.866, -0.5]]]
    .map(([at, dir]) => ({ at: out(at, ext), dir, size: 0.62, max: 1.25 }));
  return { track, home, yard, label, outline, dice, extent: 9.2 + ext };
}

export const BOARDS = { 4: cross(), 6: star() };
const LONG = {};
// the board for a game: the 6-color board comes with 10 or 14 fields per corridor
export function boardFor(n, corridorLen = 10) {
  if (n !== 6 || corridorLen === 10) return BOARDS[n];
  return (LONG[corridorLen] = LONG[corridorLen] || star((corridorLen - 2) / 2));
}
