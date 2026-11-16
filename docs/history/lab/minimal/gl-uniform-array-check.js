// Isolated check: does the WebGL library deliver a float array uniform
// (`uniform float m[20]`, set with uniform1fv) to a fragment shader?
// Draws one full-screen quad whose colour comes from the array and reads a
// pixel back. Expected with a working implementation: 255,128,64,255.
const createGL = require('gl');
const gl = createGL(16, 16, { preserveDrawingBuffer: true });

function shader(type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const program = gl.createProgram();
gl.attachShader(program, shader(gl.VERTEX_SHADER,
  'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }'));
gl.attachShader(program, shader(gl.FRAGMENT_SHADER,
  'precision mediump float; uniform float m[20]; void main(){ gl_FragColor = vec4(m[0], m[7], m[19], 1.0); }'));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
gl.useProgram(program);

const active = [];
for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
  const info = gl.getActiveUniform(program, i);
  active.push(info.name + ' size=' + info.size + ' type=0x' + info.type.toString(16));
}
console.log('active uniforms:', active.join('; '));

const values = new Float32Array(20);
values[0] = 1.0; values[7] = 0.5; values[19] = 0.25;

function drawAndRead(label) {
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const px = new Uint8Array(4);
  gl.readPixels(8, 8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  console.log(label + ':', Array.from(px).join(','), '| gl error 0x' + gl.getError().toString(16));
}

for (const name of ['m', 'm[0]']) {
  const location = gl.getUniformLocation(program, name);
  console.log('location for "' + name + '":', location ? 'found' : 'null');
  if (!location) continue;
  gl.uniform1fv(location, new Float32Array(20));          // reset to zeros
  gl.uniform1fv(location, values);
  drawAndRead('uniform1fv via "' + name + '" (Float32Array)');
  gl.uniform1fv(location, new Float32Array(20));
  gl.uniform1fv(location, Array.from(values));
  drawAndRead('uniform1fv via "' + name + '" (plain array)');
}
process.exit(0);
