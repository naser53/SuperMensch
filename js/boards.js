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
  const label = [[1.5, 2.6], [8.5, 2.6], [8.5, 7.4], [1.5, 7.4]].map(p => g(...p));
  const outline = [[-5.6, -5.6], [5.6, -5.6], [5.6, 5.6], [-5.6, 5.6]];
  // where the dice settle: a free row beside each yard (at = its middle, dir = along the row),
  // found by a search for the place nearest the yard that keeps clear of every field
  const dice = [[-3.3, -4.5], [3.3, -4.5], [3.3, 4.5], [-3.3, 4.5]].map(at => ({ at, dir: [0, 1], size: 0.55 }));
  return { track, home, yard, label, outline, dice };
}

// ---- 6 colors: six arms like the wooden 6-player board, 10 fields per corridor ----
// Per corridor: 4 fields on the arm's inbound row (gate first), one junction field at the
// inner corner, 4 on the next arm's outbound row and the tip of that arm.
function star() {
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
    for (let k = 0; k < 4; k++) track.push(pt(c, d1 + 3 - k, 1));
    const a = pt(c, d1, 1), b = pt(n, d1, -1);
    track.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    for (let k = 0; k < 4; k++) track.push(pt(n, d1 + k, -1));
    track.push(pt(n, d1 + 3, 0));
  }
  // track[10c] is color c's gate; track[10c + 9], the tip of arm c+1, is color c+1's threshold
  const home = [0, 1, 2, 3, 4, 5].map(c => [0, 1, 2, 3].map(k => pt(c, d1 + 2 - k, 0)));
  const at = (c, r) => [Math.cos(rad(-120 + 60 * c)) * r, Math.sin(rad(-120 + 60 * c)) * r];
  const yard = [0, 1, 2, 3, 4, 5].map(c => {
    const [x, y] = at(c, 6.9);
    return [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]].map(([ox, oy]) => [x + ox, y + oy]);
  });
  const label = [0, 1, 2, 3, 4, 5].map(c => at(c, 5.15));
  const outline = [0, 1, 2, 3, 4, 5].map(c => at(c, 8.7));
  // where the dice settle: a free row beside each yard (at = its middle, dir = along the row),
  // found by a search for the place nearest the yard that keeps clear of every field
  const dice = [[[-2.1, -6.38], [0.383, 0.924]], [[2.1, -6.38], [-0.383, 0.924]], [[6.6, -1.3], [-0.991, 0.131]],
    [[2.1, 6.38], [0.383, 0.924]], [[-2.1, 6.38], [-0.383, 0.924]], [[-6.6, -1.3], [0.991, 0.131]]]
    .map(([at, dir]) => ({ at, dir, size: 0.62 }));
  return { track, home, yard, label, outline, dice };
}

export const BOARDS = { 4: cross(), 6: star() };
