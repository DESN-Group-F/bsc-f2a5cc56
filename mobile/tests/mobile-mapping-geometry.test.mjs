import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultMappingCamera, invertMatrix, mappingMatrix, multiplyMatrix, pickMappingRoom, rayBoxDistance, schematicRoomModules, transformPoint } from '../src/features/inventory/mapping-geometry.mjs';
import { createMappingRenderer } from '../src/features/inventory/mapping-renderer.mjs';

test('schematic modules have real three-dimensional volume and deterministic directory-only layout', () => {
  const rooms = [{ id: 'A' }, { id: 'B' }, { id: 'C' }], modules = schematicRoomModules(rooms);
  assert.deepEqual(modules.map(item => item.id), ['A', 'B', 'C']);
  assert.ok(modules.every(item => item.size.every(size => size > 0))); assert.deepEqual(modules, schematicRoomModules(rooms));
  assert.deepEqual(schematicRoomModules([]), []);
});
test('camera matrix roundtrip and picking resolve the projected volume after orbit, pan and zoom', () => {
  const modules = schematicRoomModules([{ id: 'A' }]);
  for (const camera of [defaultMappingCamera(), { yaw: 1.25, pitch: .45, zoom: 2, target: [1, 0, -1] }]) {
    const matrix = mappingMatrix(camera, 1.1, 1), inverse = invertMatrix(matrix), identity = multiplyMatrix(matrix, inverse);
    for (let i = 0; i < 16; i++) assert.ok(Math.abs(identity[i] - Number(i % 5 === 0)) < 1e-5);
    const point = transformPoint(matrix, modules[0].center);
    assert.equal(pickMappingRoom(matrix, point[0], point[1], modules), 'A');
    const world = transformPoint(inverse, point); world.forEach((value, index) => assert.ok(Math.abs(value - modules[0].center[index]) < 1e-5));
    assert.equal(pickMappingRoom(matrix, -3, 3, modules), null);
  }
});
test('ray-box intersection rejects parallel misses and picks the nearest overlapping room at low angle', () => {
  const modules = [{ id: 'rear', center: [0, .48, 0], size: [2.65, .96, 2.2] }, { id: 'front', center: [0, .48, 3], size: [2.65, .96, 2.2] }];
  assert.equal(rayBoxDistance([5, 1, 5], [0, 0, -1], modules[0]), null);
  assert.equal(rayBoxDistance([0, .48, 5], [0, 0, -1], modules[0]), 3.9);
  const matrix = mappingMatrix({ yaw: 0, pitch: .24, zoom: 1, target: [0, 0, 0] }, 1, 2);
  const projectedRear = transformPoint(matrix, [0, .05, 0]);
  assert.equal(pickMappingRoom(matrix, projectedRear[0], projectedRear[1], modules), 'front');
});

function fakeGraphics() {
  const commands = [], enabled = new Set(); let mask = [true, true, true, true], framebuffer = null, center = null, serial = 0;
  const gl = {};
  for (const name of ['VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS', 'ARRAY_BUFFER', 'STATIC_DRAW', 'FLOAT', 'DEPTH_TEST', 'BLEND', 'TRIANGLES', 'FRAMEBUFFER', 'TEXTURE_2D', 'RGBA', 'UNSIGNED_BYTE', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER', 'LINEAR', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'CLAMP_TO_EDGE', 'RENDERBUFFER', 'DEPTH_COMPONENT16', 'COLOR_ATTACHMENT0', 'DEPTH_ATTACHMENT', 'FRAMEBUFFER_COMPLETE', 'COLOR_BUFFER_BIT', 'DEPTH_BUFFER_BIT', 'TEXTURE0']) gl[name] = name;
  for (const name of ['createShader', 'createProgram', 'createBuffer', 'createFramebuffer', 'createTexture', 'createRenderbuffer']) gl[name] = () => ({ id: ++serial });
  for (const name of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'deleteShader', 'deleteProgram', 'deleteBuffer', 'deleteFramebuffer', 'deleteTexture', 'deleteRenderbuffer', 'bindBuffer', 'bufferData', 'bindTexture', 'texImage2D', 'texParameteri', 'bindRenderbuffer', 'renderbufferStorage', 'framebufferTexture2D', 'framebufferRenderbuffer', 'useProgram', 'enableVertexAttribArray', 'disableVertexAttribArray', 'vertexAttribPointer', 'uniformMatrix4fv', 'viewport', 'clearColor', 'clear', 'activeTexture', 'uniform1i', 'uniform2f', 'uniform1f']) gl[name] = () => {};
  gl.getShaderParameter = gl.getProgramParameter = () => true; gl.getShaderInfoLog = () => '';
  gl.getAttribLocation = (_program, name) => name === 'aNormal' ? 1 : 0; gl.getUniformLocation = (_program, name) => name;
  gl.checkFramebufferStatus = () => gl.FRAMEBUFFER_COMPLETE; gl.isContextLost = () => false;
  gl.bindFramebuffer = (_target, value) => { framebuffer = value; };
  gl.enable = name => enabled.add(name); gl.disable = name => enabled.delete(name);
  gl.uniform3fv = (name, value) => { if (name === 'uCenter') center = [...value]; };
  gl.colorMask = (...value) => { mask = value; };
  gl.drawArrays = (_type, _first, count) => commands.push({ framebuffer, count, center: center && [...center], mask: [...mask], depth: enabled.has(gl.DEPTH_TEST) });
  return { gl, commands };
}
test('selective blur restores foreground depth before a rear selected room is drawn crisply', t => {
  const prior = globalThis.window; globalThis.window = { devicePixelRatio: 2 }; t.after(() => { if (prior === undefined) delete globalThis.window; else globalThis.window = prior; });
  const { gl, commands } = fakeGraphics(), modules = [{ id: 'rear', center: [0, .48, 0], size: [2.65, .96, 2.2] }, { id: 'front', center: [0, .48, 3], size: [2.65, .96, 2.2] }];
  const canvas = { getContext: () => gl, getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) }, renderer = createMappingRenderer(canvas, modules);
  renderer.draw({ yaw: 0, pitch: .24, zoom: 1, target: [0, 0, 0] }, 'rear');
  const screen = commands.filter(item => item.framebuffer === null), selected = screen.at(-1), foregroundDepth = screen.find(item => item.center?.[2] === 3 && item.mask.every(value => !value));
  assert.ok(foregroundDepth, 'Front room is reconstructed in the default framebuffer depth attachment'); assert.equal(foregroundDepth.depth, true);
  assert.ok(screen.indexOf(foregroundDepth) < screen.indexOf(selected)); assert.deepEqual(selected.center, modules[0].center); assert.deepEqual(selected.mask, [true, true, true, true]); assert.equal(selected.depth, true);
  assert.equal(canvas.width, 300, 'Rendering density is capped at 1.5'); renderer.dispose();
});
test('unavailable WebGL provides an explicit direct-room-list limitation', () => {
  assert.throws(() => createMappingRenderer({ getContext: () => null }, []), /Use the room list/);
});
