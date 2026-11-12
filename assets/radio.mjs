// Port of ap_mesh_update/config_radio.py, Cal_average_gpu.py and Cal_SNR.py.
// Keep physical access powers separate from the legacy clipped mesh powers.
export const DEFAULT_RADIO = Object.freeze({
  power: 20, freq: 5210, band: 80, nf: 7, rssi: -60,
  meshSnr: 4, sinr: 4, gridSize: 0.1, minDistance: 0.5,
});

export function noiseDbm(p) {
  return -174 + 10 * Math.log10(p.band * 1e6) + p.nf;
}

// Exact intersection lengths in cell units. A corner-only touch has zero loss.
export function pathLoss(walls, ax, ay, bx, by, losses = {}) {
  const dx = bx - ax, dy = by - ay, span = Math.hypot(dx, dy);
  if (span === 0) return 0;
  const height = walls.length, width = walls[0].length;
  let ix = Math.floor(ax), iy = Math.floor(ay), t = 0, loss = 0;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const txStep = dx === 0 ? Infinity : 1 / Math.abs(dx);
  const tyStep = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let tx = dx === 0 ? Infinity : (sx > 0 ? ix + 1 - ax : ax - ix) / Math.abs(dx);
  let ty = dy === 0 ? Infinity : (sy > 0 ? iy + 1 - ay : ay - iy) / Math.abs(dy);
  for (let step = 0; step < width + height + 4 && t < 1; step++) {
    const next = Math.min(1, tx, ty);
    if (ix >= 0 && ix < width && iy >= 0 && iy < height && next > t) {
      const material = walls[iy][ix];
      loss += (losses[material] ?? material) * (next - t) * span;
    }
    if (next >= 1) break;
    if (tx <= next + 1e-12) { ix += sx; tx += txStep; }
    if (ty <= next + 1e-12) { iy += sy; ty += tyStep; }
    t = next;
  }
  return loss;
}

function roundedRssi(value) {
  // NumPy/CuPy round(..., 2) uses ties-to-even; signal maps store float32.
  const scaled = value * 100, floor = Math.floor(scaled), fraction = scaled - floor;
  const rounded = fraction === 0.5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(scaled);
  return Math.fround(rounded / 100);
}

export function receivedPower(walls, ap, x, y, p, losses = {}) {
  if (walls[y][x] > 0) return NaN;
  const distance = Math.max(DEFAULT_RADIO.minDistance,
    Math.hypot(ap.x - x, ap.y - y) * DEFAULT_RADIO.gridSize);
  const fspl = 32.44 + 20 * Math.log10(p.freq) + 20 * Math.log10(distance / 1000);
  const attenuation = pathLoss(walls, ap.x + 0.5, ap.y + 0.5, x + 0.5, y + 0.5, losses);
  return roundedRssi((ap.power ?? p.power) - fspl - attenuation);
}

export function buildMesh(received, p) {
  const count = received.length, noise = noiseDbm(p), edges = [];
  const adjacency = Array.from({length: count}, () => []);
  const clip = value => Math.min(-20, Math.max(-100, value));
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
    const ab = clip(received[i][j]), ba = clip(received[j][i]);
    const snrAB = ab - noise, snrBA = ba - noise, snr = Math.min(snrAB, snrBA);
    const ok = Number.isFinite(snr) && snr >= p.meshSnr;
    edges.push({i, j, ab, ba, snrAB, snrBA, snr, ok});
    if (ok) { adjacency[i].push(j); adjacency[j].push(i); }
  }
  const visited = new Set(), components = [];
  for (let i = 0; i < count; i++) {
    if (visited.has(i)) continue;
    const stack = [i], component = []; visited.add(i);
    while (stack.length) {
      const node = stack.pop(); component.push(node);
      for (const peer of adjacency[node]) if (!visited.has(peer)) { visited.add(peer); stack.push(peer); }
    }
    components.push(component.sort((a, b) => a - b));
  }
  const largest = [...components].sort((a, b) => b.length - a.length || a[0] - b[0])[0] ?? [];
  const members = new Set(largest), inMesh = Array.from({length: count}, (_, i) => members.has(i));
  return {edges, adjacency, components, inMesh, connectivity: count ? largest.length / count : 0};
}

export function accessLinks(received, inMesh, p) {
  if (received.length !== inMesh.length) throw Error('AP powers and mesh membership must align');
  const noise = noiseDbm(p), noiseMw = 10 ** (noise / 10);
  const powers = received.map(value => Number.isFinite(value) ? 10 ** (value / 10) : 0);
  let serving = -1, selectedSinr = -Infinity;
  const candidates = received.map((rssi, ap) => {
    // Directly sum OTHER powers at this receiver. Never average dBm or use
    // total-minus-desired, which can lose extremely weak interference.
    let interferenceMw = 0;
    const interferingAps = [];
    for (let other = 0; other < powers.length; other++) if (other !== ap) {
      interferenceMw += powers[other];
      if (powers[other] > 0) interferingAps.push(other);
    }
    const noiseInterferenceDbm = 10 * Math.log10(noiseMw + interferenceMw);
    const sinr = Number.isFinite(rssi) ? rssi - noiseInterferenceDbm : -Infinity;
    const valid = inMesh[ap] && Number.isFinite(sinr) && sinr >= p.sinr;
    if (valid && sinr > selectedSinr) { serving = ap; selectedSinr = sinr; }
    return {ap, rssi, snr: Number.isFinite(rssi) ? rssi - noise : -Infinity,
      sinr, noiseDbm: noise, interferenceMw,
      interferenceDbm: interferenceMw > 0 ? 10 * Math.log10(interferenceMw) : null,
      noiseInterferenceDbm, interferingAps, mesh: inMesh[ap], valid};
  });
  return {candidates, serving, sinr: selectedSinr, connected: serving >= 0};
}
