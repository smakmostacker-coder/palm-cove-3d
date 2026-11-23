// On-foot controller: WASD movement relative to the camera, Shift sprint,
// mouse-orbit third-person camera, building collision.
import { G } from './state.js';
import { TUNING, SPAWN } from './config.js';
import { collideBuildings } from './city.js';
import { makePerson } from './city.js';

export const player = { mesh: null, pos: null, angle: 0, swing: 0, speedNow: 0 };
export function buildPlayer(scene) {
  player.mesh = makePerson(0x00a8ff, 0x2f3542, 0xf1c27d); // Vera: blue jacket
  player.mesh.position.set(SPAWN.x, 0.3, SPAWN.z);
  player.pos = player.mesh.position;
  player.angle = Math.PI; // face north (-z is forward at yaw PI for our camera math)
  scene.add(player.mesh);
  return player;
}
export function updatePlayer(dt, camera) {
  const k = G.keys;
  let ix = 0, iz = 0;
  if (k['KeyW'] || k['ArrowUp']) iz -= 1;
  if (k['KeyS']) iz += 1;
  if (k['KeyA']) ix -= 1;
  if (k['KeyD']) ix += 1;
  const sprint = k['ShiftLeft'] || k['ShiftRight'];
  const speed = sprint ? TUNING.sprintSpeed : TUNING.walkSpeed;
  const moving = ix !== 0 || iz !== 0;
  player.speedNow = moving ? speed : 0;
  if (moving) {
    const len = Math.hypot(ix, iz); ix /= len; iz /= len;
    const sin = Math.sin(G.camYaw), cos = Math.cos(G.camYaw);
    const wx = ix * cos - iz * sin, wz = ix * sin + iz * cos;
    player.pos.x += wx * speed * dt;
    player.pos.z += wz * speed * dt;
    player.angle = Math.atan2(wx, wz);
    player.swing += dt * speed * 1.6;
  }
  collideBuildings(player.pos, 0.7);
  player.mesh.position.y = 0.3;
  player.mesh.rotation.y = player.angle;
  player.mesh.userData.armL.rotation.x = Math.sin(player.swing) * (moving ? 0.7 : 0);
  player.mesh.userData.armR.rotation.x = -Math.sin(player.swing) * (moving ? 0.7 : 0);
  updateCamera(dt, camera, player.pos, 9);
}
export function updateCamera(dt, camera, target, dist) {
  // Forward (W) is (sin yaw, -cos yaw); the camera sits the opposite way, behind the target.
  const bx = target.x - Math.sin(G.camYaw) * Math.cos(G.camPitch) * dist;
  const bz = target.z + Math.cos(G.camYaw) * Math.cos(G.camPitch) * dist;
  camera.position.set(bx, target.y + 2 + Math.sin(G.camPitch) * dist, bz);
  camera.lookAt(target.x, target.y + 1.6, target.z);
}
