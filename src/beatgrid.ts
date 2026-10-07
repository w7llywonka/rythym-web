// Beat-tracked songs store only their beat boundaries; the 16th-note grid is rebuilt from them the
// same way everywhere (analysis, the bundled licensed tracks, the game), so charts are identical.

const round = (t: number) => Math.round(t * 10000) / 10000;

/**
 * Four 16th-note steps per beat. `bounds` are beat times plus one final boundary (where the last
 * beat ends); `steps` cuts the grid to the analysed length.
 */
export function gridFromBeats(bounds: number[], steps = Infinity): number[] {
  const grid: number[] = [];
  for (let i = 0; i + 1 < bounds.length && grid.length < steps; i++) {
    const span = bounds[i + 1] - bounds[i];
    for (let q = 0; q < 4 && grid.length < steps; q++) grid.push(round(bounds[i] + span * q / 4));
  }
  return grid;
}

export const roundBeats = (bounds: number[]) => bounds.map(round);
