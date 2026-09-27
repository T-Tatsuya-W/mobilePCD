import { pcdToFrequencyDomain } from './pcd-dft.js';

// The prototype torus lies in the XY plane, matching Three.js TorusGeometry.
export const TORUS_MAJOR_RADIUS = 1.55;
export const TORUS_MINOR_RADIUS = 0.68;

// Keep the original app's PCD-DFT coordinate choices: k=5 phase,
// k=3 phase, and k=3 magnitude respectively.
export function pcdToToroidal(pcd) {
  const { amplitudes, phases } = pcdToFrequencyDomain(pcd);
  return { theta: phases[5], phi: phases[3], r: amplitudes[3] };
}

export function toroidalToCartesian(theta, phi, r, out = {}) {
  const tubeRadius = r * TORUS_MINOR_RADIUS;
  const distance = TORUS_MAJOR_RADIUS + tubeRadius * Math.cos(phi);
  out.x = distance * Math.cos(theta);
  out.y = distance * Math.sin(theta);
  out.z = tubeRadius * Math.sin(phi);
  return out;
}
