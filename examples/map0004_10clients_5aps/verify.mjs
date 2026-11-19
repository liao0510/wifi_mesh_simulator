// Compare the actual browser radio core with saved ap_mesh_update outputs.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {noiseDbm, receivedPower, buildMesh, accessLinks} from '../../assets/radio.mjs';

const reference = JSON.parse(fs.readFileSync(new URL('expected_results.json', import.meta.url), 'utf8'));
const verification = {};
for (const name of ['model_prediction', 'search_improved']) {
  const project = JSON.parse(fs.readFileSync(new URL(name + '.json', import.meta.url), 'utf8'));
  const {map, aps, clients} = project, s = project.settings, expected = reference[name];
  const p = {power: +s.power, freq: +s.freq, band: +s.band, nf: +s.nf, rssi: +s.threshold,
    meshSnr: +s.meshSnrThreshold, sinr: +s.sinrThreshold};
  const received = aps.map(ap => aps.map(target => receivedPower(map.wall_map, ap, target.x, target.y, p)));
  const mesh = buildMesh(received, p);
  assert.deepEqual(mesh.inMesh, expected.in_mesh);
  assert.equal(mesh.edges.filter(edge => edge.ok).length, expected.mesh_edges.length);
  let maxRssiError = 0, maxSinrError = 0, maxSnrError = 0, maxInterferenceError = 0;
  for (const edge of expected.mesh_edges) {
    const actual = mesh.edges.find(e => e.i === edge.ap_a && e.j === edge.ap_b);
    maxSnrError = Math.max(maxSnrError, Math.abs(actual.snrAB - edge.snr_a_to_b_db), Math.abs(actual.snrBA - edge.snr_b_to_a_db));
  }
  const clientRows = clients.map((client, i) => {
    const powers = aps.map(ap => receivedPower(map.wall_map, ap, client.x, client.y, p));
    const result = accessLinks(powers, mesh.inMesh, p), original = expected.allocation_results[i];
    assert.equal(result.serving, original.ap);
    const selected = result.candidates[result.serving];
    maxRssiError = Math.max(maxRssiError, Math.abs(selected.rssi - original.rssi_dbm));
    maxSinrError = Math.max(maxSinrError, Math.abs(selected.sinr - original.sinr_db));
    maxInterferenceError = Math.max(maxInterferenceError, Math.abs(selected.interferenceMw - original.interference_mw));
    return {client: client.id, ap: aps[result.serving].id, rssi_dbm: selected.rssi,
      sinr_db: selected.sinr, interference_dbm: selected.interferenceDbm,
      python_throughput_mbps: original.throughput_mbps};
  });
  let valid = 0, covered = 0;
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    if (map.wall_map[y][x] !== 0) continue;
    valid++;
    let best = -Infinity;
    for (let i = 0; i < aps.length; i++) if (mesh.inMesh[i]) best = Math.max(best, receivedPower(map.wall_map, aps[i], x, y, p));
    if (best >= p.rssi) covered++;
  }
  const coverage = covered / valid, coverageDifference = Math.abs(coverage - expected.metrics.coverage);
  assert.ok(maxRssiError <= .01001, 'RSSI differs beyond one rounding step');
  assert.ok(maxSinrError <= .02002, 'SINR differs beyond propagation rounding');
  assert.ok(maxSnrError <= .01001, 'mesh SNR differs beyond propagation rounding');
  assert.ok(coverageDifference <= 1 / valid, 'coverage differs by more than one threshold-boundary cell');
  verification[name] = {client_count: clients.length, ap_count: aps.length, noise_dbm: noiseDbm(p),
    serving_aps: mesh.inMesh, qualified_mesh_edges: mesh.edges.filter(e => e.ok).length,
    max_client_rssi_difference_db: maxRssiError, max_client_sinr_difference_db: maxSinrError,
    max_mesh_snr_difference_db: maxSnrError, max_interference_difference_mw: maxInterferenceError,
    browser_coverage: coverage, python_coverage: expected.metrics.coverage,
    coverage_difference: coverageDifference, clients: clientRows};
}
fs.writeFileSync(new URL('verification.json', import.meta.url), JSON.stringify(verification, null, 2));
console.log(JSON.stringify(verification, null, 2));
