// Second-stage check of the canvas and image binding, run by the player on
// the handheld. It draws on a canvas the way the game's engine does and
// shows the result through WebGL:
//   - a gradient background and solid rectangles with a blend mode;
//   - text in a font loaded from a file, outlined and then filled, which is
//     how the engine draws every string;
//   - a region of a PNG image, copied unscaled and scaled;
//   - pixels read back from the canvas;
//   - the canvas uploaded as a WebGL texture and redrawn when it changes.
// The font and the image are passed in as paths (see FONT and IMAGE). Exits
// with 0 when every check passes.
var gl = player.gl;
var c2d = player.canvas;
var FONT = '/opt/rpgmv-lab/www/fonts/mplus-1m-regular.ttf';
var IMAGE = '/opt/rpgmv-lab/www/img/system/IconSet.png';
var W = 816, H = 624;

var failures = [];
function check(label, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail !== undefined ? ': ' + detail : ''));
  if (!ok) failures.push(label);
}

var canvas = c2d.create(W, H);
check('canvas created', c2d.size(canvas).join('x') === W + 'x' + H, c2d.size(canvas).join('x'));

function paintBackground() {
  var gradient = c2d.createLinearGradient(0, 0, 0, H);
  c2d.addColorStop(gradient, 0, 0.10, 0.12, 0.30, 1);
  c2d.addColorStop(gradient, 1, 0.02, 0.02, 0.05, 1);
  c2d.setOperator(canvas, 'source-over');
  c2d.fillRect(canvas, 0, 0, W, H, gradient, 1);
  // Three overlapping bars added together, as the 'lighter' mode does.
  c2d.setOperator(canvas, 'lighter');
  c2d.fillRect(canvas, 40, 420, 300, 60, [0.6, 0, 0, 1], 1);
  c2d.fillRect(canvas, 140, 450, 300, 60, [0, 0.6, 0, 1], 1);
  c2d.fillRect(canvas, 240, 480, 300, 60, [0, 0, 0.6, 1], 1);
  c2d.setOperator(canvas, 'source-over');
}

function text(string, x, y, size) {
  c2d.setFont(canvas, 'TestFont', size);
  // Outline first, then fill, with round joins: the engine's way.
  c2d.strokeText(canvas, string, x, y, [0, 0, 0, 0.6], 1, 4, true);
  c2d.fillText(canvas, string, x, y, [1, 1, 1, 1], 1);
}

check('font file registered', c2d.registerFont('TestFont', FONT) === true, FONT);
var image = c2d.loadImage(IMAGE);
check('PNG image decoded', image !== null, IMAGE);
var imageSize = image ? c2d.size(image) : [0, 0];
console.log('image size: ' + imageSize.join('x'));
check('missing image gives null', c2d.loadImage('/nonexistent/file.png') === null);

function paint(seconds) {
  paintBackground();
  text('Canvas 2D through Cairo and FreeType', 40, 70, 34);
  text('Text is outlined and then filled, as the engine does.', 40, 120, 22);
  text('Seconds on screen: ' + seconds, 40, 170, 28);
  if (image) {
    // A 192x96 region of the image, once unscaled and once at double size.
    c2d.drawImage(canvas, image, 0, 0, 192, 96, 40, 210, 192, 96, 1);
    c2d.drawImage(canvas, image, 0, 0, 192, 96, 280, 210, 384, 192, 1);
  }
}
paint(0);

c2d.setFont(canvas, 'TestFont', 28);
var measured = c2d.measureText(canvas, 'Seconds on screen: 0');
check('text has a width', measured[0] > 100 && measured[1] > 0, measured.map(function (v) { return v.toFixed(1); }).join(', '));

var pixel = c2d.getImageData(canvas, 100, 440, 1, 1);
check('red bar reads back', pixel[0] > 140 && pixel[1] < 40 && pixel[3] === 255, Array.from(pixel).join(','));
var overlap = c2d.getImageData(canvas, 200, 465, 1, 1);
check('overlapping bars were added', overlap[0] > 140 && overlap[1] > 140, Array.from(overlap).join(','));

// --- Show the canvas through WebGL ----------------------------------------
function compile(type, source) {
  var shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}
var program = gl.createProgram();
gl.attachShader(program, compile(gl.VERTEX_SHADER,
    'attribute vec2 aPosition; attribute vec2 aCoord; varying vec2 vCoord;' +
    'void main(){ vCoord = aCoord; gl_Position = vec4(aPosition, 0.0, 1.0); }'));
gl.attachShader(program, compile(gl.FRAGMENT_SHADER,
    'precision mediump float; varying vec2 vCoord; uniform sampler2D uSampler;' +
    'void main(){ gl_FragColor = texture2D(uSampler, vCoord); }'));
gl.bindAttribLocation(program, 0, 'aPosition');
gl.bindAttribLocation(program, 1, 'aCoord');
gl.linkProgram(program);
check('program links', gl.getProgramParameter(program, gl.LINK_STATUS), gl.getProgramInfoLog(program));
gl.useProgram(program);

// Fit the 816x624 picture inside the screen, keeping its proportions.
var scale = Math.min(gl.drawingBufferWidth / W, gl.drawingBufferHeight / H);
var x = W * scale / gl.drawingBufferWidth, y = H * scale / gl.drawingBufferHeight;
var quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
// The top row of the canvas is the first row uploaded, so the top of the quad uses coordinate 0.
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-x, -y, 0, 1, x, -y, 1, 1, -x, y, 0, 0, x, y, 1, 0]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

var texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
check('no WebGL error after uploading the canvas', gl.getError() === gl.NO_ERROR);

var SECONDS = 8;
var started = null, lastSecond = 0, uploads = 0, uploadMs = 0;
var intervals = [], last = null;
function frame(now) {
  if (started === null) started = now;
  if (last !== null) intervals.push(now - last);
  last = now;
  var second = Math.floor((now - started) / 1000);
  if (second !== lastSecond) {
    // The canvas changed: repaint it and upload it again.
    lastSecond = second;
    var before = performance.now();
    paint(second);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    uploadMs += performance.now() - before;
    uploads++;
  }
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  if (now - started < SECONDS * 1000) {
    requestAnimationFrame(frame);
    return;
  }
  var screenPixel = new Uint8Array(4);
  gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, screenPixel);
  console.log('centre of the screen reads ' + Array.from(screenPixel).join(','));
  var sorted = intervals.slice(10).sort(function (a, b) { return a - b; });
  console.log('frames: ' + sorted.length + ', interval median ' + sorted[sorted.length >> 1].toFixed(2) +
      ' ms, max ' + sorted[sorted.length - 1].toFixed(2) + ' ms');
  console.log('repaint and re-upload of the full canvas: ' + uploads + ' times, ' + (uploadMs / uploads).toFixed(1) + ' ms each');
  console.log('surface memory: ' + (c2d.bytesInUse() / 1048576).toFixed(1) + ' MB');
  check('no WebGL error at the end', gl.getError() === gl.NO_ERROR);
  console.log(failures.length ? 'FAILED: ' + failures.join('; ') : 'all checks passed');
  player.exit(failures.length ? 3 : 0);
}
requestAnimationFrame(frame);
