// Check of the WebGL binding, run by the player on the
// handheld. It uses WebGL the way PIXI does, without PIXI:
//   - compiles a shader pair that declares medium precision (the binding
//     must rewrite it to high precision) and reads back its active uniforms;
//   - uploads a generated texture with the premultiply flag set;
//   - draws rotating, alpha-blended quads from an index buffer;
//   - draws the whole scene into an off-screen texture first and then to the
//     screen, as the engine's tone filter does;
//   - reads pixels back and checks them.
// Exits with 0 when every check passes. Uses only generated content.
var gl = player.gl;
var failures = [];
function check(label, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail ? ': ' + detail : ''));
  if (!ok) failures.push(label);
}

function compile(type, source) {
  var shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  check('shader compiles', gl.getShaderParameter(shader, gl.COMPILE_STATUS), gl.getShaderInfoLog(shader));
  return shader;
}
var program = gl.createProgram();
gl.attachShader(program, compile(gl.VERTEX_SHADER,
    'precision mediump float; attribute vec2 aPosition; attribute vec2 aCoord;' +
    'uniform mat3 uMatrix; varying vec2 vCoord;' +
    'void main(){ vCoord = aCoord; gl_Position = vec4((uMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0); }'));
gl.attachShader(program, compile(gl.FRAGMENT_SHADER,
    'precision mediump float; varying vec2 vCoord; uniform sampler2D uSampler; uniform float uTint[4];' +
    'void main(){ gl_FragColor = texture2D(uSampler, vCoord) * vec4(uTint[0], uTint[1], uTint[2], uTint[3]); }'));
gl.bindAttribLocation(program, 0, 'aPosition');
gl.bindAttribLocation(program, 1, 'aCoord');
gl.linkProgram(program);
check('program links', gl.getProgramParameter(program, gl.LINK_STATUS), gl.getProgramInfoLog(program));
gl.useProgram(program);

var uniforms = {};
for (var i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
  var info = gl.getActiveUniform(program, i);
  uniforms[info.name] = info;
}
check('active uniforms listed', Object.keys(uniforms).length === 3, Object.keys(uniforms).join(', '));
// PIXI looks array uniforms up by their bare name.
var tintLocation = gl.getUniformLocation(program, 'uTint');
check('array uniform found by bare name', tintLocation !== null);
var matrixLocation = gl.getUniformLocation(program, 'uMatrix');
check('missing uniform gives null', gl.getUniformLocation(program, 'doesNotExist') === null);
check('context has a stencil buffer', gl.getContextAttributes().stencil === true);
check('constants present', gl.TEXTURE_2D === 0x0DE1 && gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL === 0x9241);

var highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision;
var mediump = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT).precision;
console.log('fragment precision bits: mediump ' + mediump + ', highp ' + highp);

// A 64x64 checkerboard with half-transparent squares, uploaded premultiplied.
var SIZE = 64;
var pixels = new Uint8Array(SIZE * SIZE * 4);
for (var y = 0; y < SIZE; y++) {
  for (var x = 0; x < SIZE; x++) {
    var on = ((x >> 3) + (y >> 3)) % 2 === 0;
    pixels.set(on ? [255, 255, 255, 255] : [255, 255, 255, 128], (y * SIZE + x) * 4);
  }
}
var texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIZE, SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

var vertices = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, 1, 1, 1, 1, -1, 1, 0, 1]), gl.STATIC_DRAW);
var indices = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
gl.enable(gl.BLEND);
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

// Off-screen target at the game's resolution.
var TARGET_W = 816, TARGET_H = 624;
var target = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, target);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TARGET_W, TARGET_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
var framebuffer = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
check('off-screen framebuffer complete', gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

function quad(matrix, tint) {
  gl.uniformMatrix3fv(matrixLocation, false, new Float32Array(matrix));
  gl.uniform1fv(tintLocation, tint);
  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
}
function rotation(angle, scale, tx, ty) {
  var c = Math.cos(angle) * scale, s = Math.sin(angle) * scale;
  return [c, s, 0, -s, c, 0, tx, ty, 1];
}

// One static frame first, to check pixels: a full-screen opaque red quad
// drawn into the off-screen texture, then that texture drawn to the screen.
gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
gl.viewport(0, 0, TARGET_W, TARGET_H);
gl.clearColor(0, 0, 0, 1);
gl.clear(gl.COLOR_BUFFER_BIT);
gl.bindTexture(gl.TEXTURE_2D, texture);
quad([1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 0, 0, 1]);
var read = new Uint8Array(4);
gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, read);
check('opaque square reads back as full red', read[0] === 255 && read[1] === 0 && read[3] === 255, Array.from(read).join(','));
// The 64-texel texture is stretched over the whole target, so the second
// square (texels 8 to 15) covers pixels 102 to 203 horizontally.
gl.readPixels(150, 40, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, read);
// Half-transparent white, premultiplied on upload and tinted red, over black.
check('half-transparent square was premultiplied', Math.abs(read[0] - 128) <= 2 && read[1] === 0, Array.from(read).join(','));
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
check('no WebGL error so far', gl.getError() === gl.NO_ERROR);

var FRAMES = 300;
var count = 0;
var last = null;
var intervals = [];
function frame(now) {
  if (last !== null) intervals.push(now - last);
  last = now;
  var t = count / 60;

  // Scene into the off-screen texture: twelve blended, rotating quads.
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.viewport(0, 0, TARGET_W, TARGET_H);
  gl.clearColor(0.05, 0.06, 0.12, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  for (var k = 0; k < 12; k++) {
    var a = t * (0.4 + k * 0.07) + k;
    quad(rotation(a, 0.22 + 0.03 * Math.sin(t + k), 0.7 * Math.cos(a * 0.7 + k), 0.6 * Math.sin(a * 0.9 + k)),
         [0.5 + 0.5 * Math.sin(k), 0.5 + 0.5 * Math.sin(k + 2), 0.5 + 0.5 * Math.sin(k + 4), 0.8]);
  }
  // Then the off-screen texture to the screen.
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.bindTexture(gl.TEXTURE_2D, target);
  quad([1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 1, 1, 1]);

  if (++count < FRAMES) {
    requestAnimationFrame(frame);
    return;
  }
  var sorted = intervals.slice(10).sort(function (x, y) { return x - y; });
  var over20 = sorted.filter(function (v) { return v > 20; }).length;
  console.log('frames: ' + sorted.length + ', interval median ' + sorted[sorted.length >> 1].toFixed(2) +
      ' ms, max ' + sorted[sorted.length - 1].toFixed(2) + ' ms, over 20 ms: ' + over20);
  check('no WebGL error at the end', gl.getError() === gl.NO_ERROR);
  check('frame pacing held', over20 <= 2, over20 + ' frames over 20 ms');
  console.log(failures.length ? 'FAILED: ' + failures.join('; ') : 'all checks passed');
  player.exit(failures.length ? 3 : 0);
}
requestAnimationFrame(frame);
