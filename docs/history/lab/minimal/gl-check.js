// Sanity check for the WebGL library inside the container: create a context,
// report what it is, clear to red and read one pixel back.
const createGL = require('gl');
const gl = createGL(64, 64, { stencil: true, alpha: false, premultipliedAlpha: true });
if (!gl) { console.log('no context'); process.exit(1); }
console.log('version:', gl.getParameter(gl.VERSION));
console.log('renderer:', gl.getParameter(gl.RENDERER), '| max texture', gl.getParameter(gl.MAX_TEXTURE_SIZE));
console.log('attrs:', JSON.stringify(gl.getContextAttributes()));
console.log('constructor:', gl.constructor && gl.constructor.name);
console.log('extensions:', gl.getSupportedExtensions().join(' '));
gl.clearColor(1, 0, 0, 1);
gl.clear(gl.COLOR_BUFFER_BIT);
const px = new Uint8Array(4);
gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
console.log('readback:', Array.from(px).join(','));
process.exit(0);
