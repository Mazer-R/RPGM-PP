// Check of the less common part of the WebGL binding: the state queries,
// integer and constant-attribute setters and the calls a WebAssembly
// library's own GL layer makes (RPG Maker MZ's animation library, Effekseer,
// asks whether a capability is enabled before every draw). Run next to any
// game (mvplayer --game <dir> --run this file); it runs once the game's page
// has loaded, uses only generated content, and exits with 0 when every check
// passes, 3 otherwise.
(function () {
  'use strict';
  var gl = player.gl, failures = [];
  function check(label, ok, detail) {
    console.log((ok ? 'ok   ' : 'FAIL ') + label + (ok || detail === undefined ? '' : ' (' + detail + ')'));
    if (!ok) failures.push(label);
  }
  function attempt(label, fn) {
    try { fn(); } catch (error) { check(label, false, String(error && error.message)); }
  }
  function run() {
    while (gl.getError() !== gl.NO_ERROR) { /* start clean */ }

    attempt('isEnabled', function () {
      gl.enable(gl.SCISSOR_TEST);
      check('an enabled capability reads as enabled', gl.isEnabled(gl.SCISSOR_TEST) === true);
      gl.disable(gl.SCISSOR_TEST);
      check('and as disabled after disable', gl.isEnabled(gl.SCISSOR_TEST) === false);
    });

    attempt('is* queries', function () {
      var buffer = gl.createBuffer(), texture = gl.createTexture(), frame = gl.createFramebuffer(), render = gl.createRenderbuffer();
      var shader = gl.createShader(gl.VERTEX_SHADER), program = gl.createProgram();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
      gl.bindRenderbuffer(gl.RENDERBUFFER, render);
      check('a bound buffer is a buffer', gl.isBuffer(buffer) === true);
      check('a bound texture is a texture', gl.isTexture(texture) === true);
      check('a bound framebuffer is a framebuffer', gl.isFramebuffer(frame) === true);
      check('a bound renderbuffer is a renderbuffer', gl.isRenderbuffer(render) === true);
      check('a shader is a shader', gl.isShader(shader) === true);
      check('a program is a program', gl.isProgram(program) === true);
      check('null is none of them', gl.isBuffer(null) === false && gl.isTexture(null) === false && gl.isProgram(null) === false);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);

      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      check('a texture parameter reads back', gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER) === gl.NEAREST);
      gl.bufferData(gl.ARRAY_BUFFER, 48, gl.STATIC_DRAW);
      check('a buffer\'s size reads back', gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE) === 48);
      gl.shaderSource(shader, 'void main() { gl_Position = vec4(0.0); }');
      check('a shader\'s source reads back', /gl_Position/.test(gl.getShaderSource(shader)));
    });

    attempt('integer uniforms and constant attributes', function () {
      var vs = gl.createShader(gl.VERTEX_SHADER), fs = gl.createShader(gl.FRAGMENT_SHADER), program = gl.createProgram();
      gl.shaderSource(vs, 'attribute vec4 a; attribute vec4 c; varying vec4 v; void main() { v = c; gl_Position = a; }');
      gl.shaderSource(fs, 'precision mediump float; uniform ivec2 p2; uniform ivec3 p3; uniform ivec4 p4; varying vec4 v;' +
        ' void main() { gl_FragColor = v + vec4(float(p2.x + p3.x + p4.x)); }');
      gl.compileShader(vs); gl.compileShader(fs);
      gl.attachShader(program, vs); gl.attachShader(program, fs);
      gl.linkProgram(program);
      check('the test program links', gl.getProgramParameter(program, gl.LINK_STATUS) === true, gl.getProgramInfoLog(program));
      gl.validateProgram(program);
      gl.useProgram(program);
      gl.uniform2i(gl.getUniformLocation(program, 'p2'), 1, 2);
      gl.uniform3i(gl.getUniformLocation(program, 'p3'), 1, 2, 3);
      gl.uniform4i(gl.getUniformLocation(program, 'p4'), 1, 2, 3, 4);
      gl.uniform2iv(gl.getUniformLocation(program, 'p2'), [1, 2]);
      gl.uniform3iv(gl.getUniformLocation(program, 'p3'), new Int32Array([1, 2, 3]));
      gl.uniform4iv(gl.getUniformLocation(program, 'p4'), [1, 2, 3, 4]);
      var c = gl.getAttribLocation(program, 'c');
      gl.vertexAttrib1f(c, 1); gl.vertexAttrib2f(c, 1, 0); gl.vertexAttrib3f(c, 1, 0, 0); gl.vertexAttrib4f(c, 1, 0, 0, 1);
      gl.detachShader(program, vs);
      check('a detached shader is still a shader', gl.isShader(vs) === true);
    });

    attempt('what is bound can be asked for and put back', function () {
      // A library with its own GL layer saves what is bound, binds its own
      // object, and binds the saved one again: it must get back the object
      // itself, or the page's texture is left unbound and draws black.
      var first = gl.createTexture(), second = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, first);
      check('the bound texture is given back as itself', gl.getParameter(gl.TEXTURE_BINDING_2D) === first);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      check('each texture unit has its own', gl.getParameter(gl.TEXTURE_BINDING_2D) === null);
      gl.activeTexture(gl.TEXTURE0);
      var saved = gl.getParameter(gl.TEXTURE_BINDING_2D);
      gl.bindTexture(gl.TEXTURE_2D, second);
      gl.bindTexture(gl.TEXTURE_2D, saved);
      check('putting the saved one back binds it again', gl.getParameter(gl.TEXTURE_BINDING_2D) === first && gl.isTexture(first));
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(16));
      check('and it is the one written to', gl.getError() === gl.NO_ERROR);
      gl.deleteTexture(first);
      check('a deleted texture is no longer bound', gl.getParameter(gl.TEXTURE_BINDING_2D) === null);

      var buffer = gl.createBuffer(), indices = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
      check('the bound buffers are given back as themselves',
        gl.getParameter(gl.ARRAY_BUFFER_BINDING) === buffer && gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING) === indices);
      var frame = gl.createFramebuffer(), render = gl.createRenderbuffer();
      check('the screen is no framebuffer object', gl.getParameter(gl.FRAMEBUFFER_BINDING) === null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
      gl.bindRenderbuffer(gl.RENDERBUFFER, render);
      check('the bound framebuffer and renderbuffer are given back as themselves',
        gl.getParameter(gl.FRAMEBUFFER_BINDING) === frame && gl.getParameter(gl.RENDERBUFFER_BINDING) === render);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      check('and null once unbound', gl.getParameter(gl.FRAMEBUFFER_BINDING) === null && gl.getParameter(gl.RENDERBUFFER_BINDING) === null);
      var program = gl.createProgram();
      gl.useProgram(null);
      check('no program in use is null', gl.getParameter(gl.CURRENT_PROGRAM) === null);
    });

    attempt('other state setters', function () {
      gl.hint(gl.GENERATE_MIPMAP_HINT, gl.NICEST);
      gl.lineWidth(1);
      gl.polygonOffset(0, 0);
      gl.depthRange(0, 1);
      gl.sampleCoverage(1, false);
      gl.stencilFuncSeparate(gl.FRONT, gl.ALWAYS, 0, 0xff);
      gl.stencilMaskSeparate(gl.FRONT, 0xff);
      gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.KEEP);
    });

    check('no WebGL error from any of it', gl.getError() === gl.NO_ERROR);
    console.log(failures.length ? 'FAILED: ' + failures.join('; ') : 'all checks passed');
    player.exit(failures.length ? 3 : 0);
  }
  requestAnimationFrame(run);
})();
