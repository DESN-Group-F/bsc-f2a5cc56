export const defaultMappingCamera = () => ({ yaw: -0.65, pitch: 0.72, zoom: 1, target: [0, 0, 0] });
export function schematicRoomModules(rooms) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(rooms.length)));
  const rows = Math.ceil(rooms.length / columns);
  return rooms.map((room, index) => ({ id: room.id, center: [(index % columns - (columns - 1) / 2) * 3.25, 0.48, (Math.floor(index / columns) - (rows - 1) / 2) * 2.85], size: [2.65, 0.96, 2.2] }));
}
export function multiplyMatrix(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
export function invertMatrix(input) {
  const rows = Array.from({ length: 4 }, (_, r) => [...Array.from({ length: 4 }, (_, c) => input[c * 4 + r]), ...Array.from({ length: 4 }, (_, c) => Number(c === r))]);
  for (let c = 0; c < 4; c++) {
    let pivot = c; for (let r = c + 1; r < 4; r++) if (Math.abs(rows[r][c]) > Math.abs(rows[pivot][c])) pivot = r;
    if (Math.abs(rows[pivot][c]) < 1e-10) return null;
    [rows[c], rows[pivot]] = [rows[pivot], rows[c]];
    const divisor = rows[c][c]; for (let k = 0; k < 8; k++) rows[c][k] /= divisor;
    for (let r = 0; r < 4; r++) if (r !== c) { const factor = rows[r][c]; for (let k = 0; k < 8; k++) rows[r][k] -= factor * rows[c][k]; }
  }
  return new Float32Array(Array.from({ length: 16 }, (_, index) => rows[index % 4][4 + Math.floor(index / 4)]));
}
function normalized(v) { const size = Math.hypot(...v); return v.map(value => value / size); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
export function mappingMatrix(camera, aspect, roomCount) {
  const offset = [Math.sin(camera.yaw) * Math.cos(camera.pitch), Math.sin(camera.pitch), Math.cos(camera.yaw) * Math.cos(camera.pitch)];
  const eye = camera.target.map((value, index) => value + offset[index] * 30);
  const z = normalized(offset), x = normalized(cross([0, 1, 0], z)), y = cross(z, x);
  const view = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  const halfHeight = Math.max(4, Math.ceil(Math.sqrt(Math.max(1, roomCount))) * 2.15) / camera.zoom;
  const halfWidth = halfHeight * aspect, near = 0.1, far = 100;
  const projection = new Float32Array([1 / halfWidth, 0, 0, 0, 0, 1 / halfHeight, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1]);
  return multiplyMatrix(projection, view);
}
export function transformPoint(matrix, point) {
  const input = [...point, 1], out = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[r] += matrix[c * 4 + r] * input[c];
  return out.slice(0, 3).map(value => value / out[3]);
}
export function rayBoxDistance(origin, direction, module) {
  let low = 0, high = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const minimum = module.center[axis] - module.size[axis] / 2, maximum = module.center[axis] + module.size[axis] / 2;
    if (Math.abs(direction[axis]) < 1e-9) { if (origin[axis] < minimum || origin[axis] > maximum) return null; continue; }
    const a = (minimum - origin[axis]) / direction[axis], b = (maximum - origin[axis]) / direction[axis];
    low = Math.max(low, Math.min(a, b)); high = Math.min(high, Math.max(a, b)); if (high < low) return null;
  }
  return low;
}
export function pickMappingRoom(matrix, normalizedX, normalizedY, modules) {
  const inverse = invertMatrix(matrix); if (!inverse) return null;
  const origin = transformPoint(inverse, [normalizedX, normalizedY, -1]), end = transformPoint(inverse, [normalizedX, normalizedY, 1]);
  const direction = normalized(end.map((value, index) => value - origin[index]));
  let picked = null, nearest = Infinity;
  for (const module of modules) { const distance = rayBoxDistance(origin, direction, module); if (distance !== null && distance < nearest) { nearest = distance; picked = module.id; } }
  return picked;
}
