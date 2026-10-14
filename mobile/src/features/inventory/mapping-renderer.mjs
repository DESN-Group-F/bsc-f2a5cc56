import { mappingMatrix, pickMappingRoom, transformPoint } from './mapping-geometry.mjs';

const vertexSource = `attribute vec3 aPosition; attribute vec3 aNormal; uniform mat4 uMatrix; uniform vec3 uCenter; uniform vec3 uSize; varying vec3 vNormal; void main(){ vNormal=aNormal; gl_Position=uMatrix*vec4(aPosition*uSize+uCenter,1.0); }`;
const fragmentSource = `precision mediump float; uniform vec3 uColor; varying vec3 vNormal; void main(){ float light=.67+.33*max(dot(normalize(vNormal),normalize(vec3(-.5,1.0,.6))),0.0); gl_FragColor=vec4(uColor*light,1.0); }`;
const quadVertex = `attribute vec2 aPosition; varying vec2 vUv; void main(){ vUv=aPosition*.5+.5; gl_Position=vec4(aPosition,0.0,1.0); }`;
const quadFragment = `precision mediump float; uniform sampler2D uImage; uniform vec2 uPixel; uniform float uBlur; varying vec2 vUv; void main(){ vec4 c=texture2D(uImage,vUv)*.4; c+=texture2D(uImage,vUv+vec2(uPixel.x,0.0)*uBlur)*.15; c+=texture2D(uImage,vUv-vec2(uPixel.x,0.0)*uBlur)*.15; c+=texture2D(uImage,vUv+vec2(0.0,uPixel.y)*uBlur)*.15; c+=texture2D(uImage,vUv-vec2(0.0,uPixel.y)*uBlur)*.15; gl_FragColor=c; }`;

function program(gl, vertex, fragment) {
  const shaders = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].map((type, index) => {
    const shader = gl.createShader(type); gl.shaderSource(shader, index ? fragment : vertex); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const reason = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(`3D shader could not compile: ${reason}`); }
    return shader;
  });
  const result = gl.createProgram(); shaders.forEach(shader => gl.attachShader(result, shader)); gl.linkProgram(result); shaders.forEach(shader => gl.deleteShader(shader));
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) { gl.deleteProgram(result); throw new Error('The 3D scene could not initialize.'); }
  return result;
}
function cubeVertices() {
  const result = [];
  const faces = [
    [[-1, 0, 0], [[-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5]]],
    [[1, 0, 0], [[.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5]]],
    [[0, 1, 0], [[-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5], [-.5, .5, -.5]]],
    [[0, -1, 0], [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5]]],
    [[0, 0, 1], [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]]],
    [[0, 0, -1], [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5]]],
  ];
  for (const [normal, points] of faces) for (const index of [0, 1, 2, 0, 2, 3]) result.push(...points[index], ...normal);
  return new Float32Array(result);
}

/** Native WebGL volume renderer; no surveyed dimensions or battery coordinates. */
export function createMappingRenderer(canvas, modules, onLabels) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error('3D graphics are unavailable on this device. Use the room list below.');
  let boxProgram, imageProgram, boxBuffer, quadBuffer, framebuffer, texture, depth, disposed = false, matrix;
  try {
    boxProgram = program(gl, vertexSource, fragmentSource); imageProgram = program(gl, quadVertex, quadFragment);
    boxBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, boxBuffer); gl.bufferData(gl.ARRAY_BUFFER, cubeVertices(), gl.STATIC_DRAW);
    quadBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    framebuffer = gl.createFramebuffer(); texture = gl.createTexture(); depth = gl.createRenderbuffer();
  } catch (error) { dispose(); throw error; }
  const positions = gl.getAttribLocation(boxProgram, 'aPosition'), normals = gl.getAttribLocation(boxProgram, 'aNormal');
  const uniforms = Object.fromEntries(['uMatrix', 'uCenter', 'uSize', 'uColor'].map(name => [name, gl.getUniformLocation(boxProgram, name)]));
  const imagePosition = gl.getAttribLocation(imageProgram, 'aPosition');
  let bufferWidth = 0, bufferHeight = 0, effectsAvailable = true;
  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 1.5), rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * scale)), height = Math.max(1, Math.round(rect.height * scale));
    if (width === bufferWidth && height === bufferHeight) return;
    bufferWidth = canvas.width = width; bufferHeight = canvas.height = height;
    gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    effectsAvailable = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE; gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function prepareBoxes() {
    gl.useProgram(boxProgram); gl.bindBuffer(gl.ARRAY_BUFFER, boxBuffer); gl.enableVertexAttribArray(positions); gl.enableVertexAttribArray(normals);
    gl.vertexAttribPointer(positions, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribPointer(normals, 3, gl.FLOAT, false, 24, 12); gl.uniformMatrix4fv(uniforms.uMatrix, false, matrix);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  }
  function box(module, color) { gl.uniform3fv(uniforms.uCenter, module.center); gl.uniform3fv(uniforms.uSize, module.size); gl.uniform3fv(uniforms.uColor, color); gl.drawArrays(gl.TRIANGLES, 0, 36); }
  function draw(camera, selectedId, simpleEffects = false) {
    if (disposed || gl.isContextLost()) return;
    resize(); matrix = mappingMatrix(camera, bufferWidth / bufferHeight, modules.length);
    const selectiveBlur = !!selectedId && effectsAvailable && !simpleEffects;
    gl.bindFramebuffer(gl.FRAMEBUFFER, selectiveBlur ? framebuffer : null); gl.viewport(0, 0, bufferWidth, bufferHeight); gl.clearColor(.925, .949, .965, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); prepareBoxes();
    const span = Math.max(3.5, Math.ceil(Math.sqrt(modules.length)) * 1.7);
    box({ center: [0, -.13, 0], size: [span * 2, .18, span * 2] }, [.81, .855, .9]);
    modules.forEach(module => { if (selectiveBlur && module.id === selectedId) return; box(module, module.id === selectedId ? [.28, .57, .98] : selectedId ? [.81, .86, .93] : [.61, .75, .91]); });
    if (selectiveBlur) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.useProgram(imageProgram); gl.disable(gl.DEPTH_TEST); gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.disableVertexAttribArray(normals); gl.enableVertexAttribArray(imagePosition); gl.vertexAttribPointer(imagePosition, 2, gl.FLOAT, false, 8, 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(gl.getUniformLocation(imageProgram, 'uImage'), 0); gl.uniform2f(gl.getUniformLocation(imageProgram, 'uPixel'), 1 / bufferWidth, 1 / bufferHeight); gl.uniform1f(gl.getUniformLocation(imageProgram, 'uBlur'), 2.4); gl.drawArrays(gl.TRIANGLES, 0, 6);
      // The composited color does not carry its depth attachment. Rebuild the
      // background depth before drawing the crisp room so picking and visible
      // occlusion agree, including overlapping modules at low camera angles.
      prepareBoxes(); gl.colorMask(false, false, false, false);
      box({ center: [0, -.13, 0], size: [span * 2, .18, span * 2] }, [.81, .855, .9]);
      modules.forEach(module => { if (module.id !== selectedId) box(module, [.81, .86, .93]); });
      gl.colorMask(true, true, true, true);
      const selected = modules.find(module => module.id === selectedId); if (selected) box(selected, [.28, .57, .98]);
    }
    onLabels?.(modules.map(module => { const point = transformPoint(matrix, [module.center[0], module.size[1] + .15, module.center[2]]); return { id: module.id, x: (point[0] + 1) * 50, y: (1 - point[1]) * 50, visible: Math.abs(point[0]) < .93 && Math.abs(point[1]) < .93 }; }));
  }
  function pick(clientX, clientY) { const rect = canvas.getBoundingClientRect(); return matrix ? pickMappingRoom(matrix, (clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2, modules) : null; }
  function dispose() {
    if (disposed) return; disposed = true;
    if (boxProgram) gl.deleteProgram(boxProgram); if (imageProgram) gl.deleteProgram(imageProgram); if (boxBuffer) gl.deleteBuffer(boxBuffer); if (quadBuffer) gl.deleteBuffer(quadBuffer);
    if (framebuffer) gl.deleteFramebuffer(framebuffer); if (texture) gl.deleteTexture(texture); if (depth) gl.deleteRenderbuffer(depth);
  }
  return { draw, pick, dispose };
}
