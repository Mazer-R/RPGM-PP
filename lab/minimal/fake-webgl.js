// A WebGL context that accepts every call and draws nothing.
//
// Purpose: let PIXI run its real WebGL renderer in the stubbed runner, so the
// processor time PIXI spends preparing a frame (walking the scene, building
// batches, setting uniforms) can be measured without a GPU or a driver.
//
// PIXI inspects each shader program it links: it asks which attributes and
// uniforms the program has and with which types. A real driver answers from
// the compiled shader; this stand-in answers by reading the declarations in
// the shader source text.
'use strict';

// Every upper-case property is treated as a WebGL constant and given a stable
// number of its own, so the same name always yields the same value and
// different names never collide.
const constants = new Map();
const constantNames = [];
function constant(name) {
  if (!constants.has(name)) {
    constants.set(name, 0x10000 + constantNames.length);
    constantNames.push(name);
  }
  return constants.get(name);
}
function nameOf(value) {
  return constantNames[value - 0x10000];
}

const GLSL_TYPES = {
  float: 'FLOAT', vec2: 'FLOAT_VEC2', vec3: 'FLOAT_VEC3', vec4: 'FLOAT_VEC4',
  int: 'INT', ivec2: 'INT_VEC2', ivec3: 'INT_VEC3', ivec4: 'INT_VEC4',
  bool: 'BOOL', bvec2: 'BOOL_VEC2', bvec3: 'BOOL_VEC3', bvec4: 'BOOL_VEC4',
  mat2: 'FLOAT_MAT2', mat3: 'FLOAT_MAT3', mat4: 'FLOAT_MAT4', sampler2D: 'SAMPLER_2D',
};

// Reads `attribute` and `uniform` declarations out of shader source text.
function declarations(source, keyword) {
  const text = String(source).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const defines = {};
  for (const m of text.matchAll(/#define\s+(\w+)\s+(\d+)/g)) defines[m[1]] = Number(m[2]);
  const pattern = new RegExp('\\b' + keyword + '\\s+(?:(?:lowp|mediump|highp)\\s+)?(\\w+)\\s+(\\w+)\\s*(?:\\[\\s*(\\w+)\\s*\\])?\\s*;', 'g');
  const found = [];
  for (const m of text.matchAll(pattern)) {
    const isArray = m[3] !== undefined;
    const size = isArray ? (Number(m[3]) || defines[m[3]] || 1) : 1;
    found.push({ name: m[2] + (isArray ? '[0]' : ''), size, type: constant(GLSL_TYPES[m[1]] || 'FLOAT') });
  }
  return found;
}

function createFakeWebGL(canvas, counters) {
  const programs = new WeakMap();
  const sources = new WeakMap();

  function describe(program) {
    const info = programs.get(program);
    if (!info.described) {
      const seen = new Set();
      const unique = (list) => list.filter((d) => !seen.has(d.name) && seen.add(d.name));
      const all = info.shaders.map((s) => sources.get(s) || '');
      info.attributes = unique(all.flatMap((src) => declarations(src, 'attribute')));
      seen.clear();
      info.uniforms = unique(all.flatMap((src) => declarations(src, 'uniform')));
      info.described = true;
    }
    return info;
  }

  const limits = {
    MAX_TEXTURE_SIZE: 8192, MAX_TEXTURE_IMAGE_UNITS: 16, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32,
    MAX_VERTEX_ATTRIBS: 16, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 16, MAX_RENDERBUFFER_SIZE: 8192,
    MAX_VARYING_VECTORS: 15, MAX_VERTEX_UNIFORM_VECTORS: 256, MAX_FRAGMENT_UNIFORM_VECTORS: 256,
    VERSION: 'WebGL 1.0 (lab stand-in)', SHADING_LANGUAGE_VERSION: 'WebGL GLSL ES 1.0', VENDOR: 'lab', RENDERER: 'lab',
  };

  const methods = {
    canvas,
    drawingBufferWidth: canvas.width, drawingBufferHeight: canvas.height,
    getContextAttributes: () => ({ alpha: true, depth: true, stencil: true, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false }),
    isContextLost: () => false,
    getError: () => 0,
    getExtension: () => null,
    getSupportedExtensions: () => [],
    getParameter: (name) => {
      const key = nameOf(name);
      return key in limits ? limits[key] : 0;
    },
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    createShader: () => ({}),
    createProgram: () => { const p = {}; programs.set(p, { shaders: [] }); return p; },
    createTexture: () => ({}), createBuffer: () => ({}), createFramebuffer: () => ({}), createRenderbuffer: () => ({}),
    shaderSource: (shader, source) => { sources.set(shader, source); },
    attachShader: (program, shader) => { programs.get(program).shaders.push(shader); },
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    getProgramParameter: (program, name) => {
      const key = nameOf(name);
      if (key === 'ACTIVE_ATTRIBUTES') return describe(program).attributes.length;
      if (key === 'ACTIVE_UNIFORMS') return describe(program).uniforms.length;
      return true;
    },
    getActiveAttrib: (program, index) => describe(program).attributes[index],
    getActiveUniform: (program, index) => describe(program).uniforms[index],
    getAttribLocation: (program, name) => describe(program).attributes.findIndex((a) => a.name === name),
    getUniformLocation: (program, name) => {
      const wanted = String(name).replace(/\[0\]$/, '');
      return describe(program).uniforms.some((u) => u.name.replace(/\[0\]$/, '') === wanted) ? { name } : null;
    },
    checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE'),
  };

  const noop = function () {};
  const counted = {};
  return new Proxy(methods, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      if (/^[A-Z][A-Z0-9_]*$/.test(key)) return constant(key);
      let fn = counted[key];
      if (fn) return fn;
      const real = key in target ? target[key] : noop;
      if (typeof real !== 'function') return real;
      // Count calls per function so the per-frame call volume can be reported.
      fn = counted[key] = function () { counters[key] = (counters[key] || 0) + 1; return real.apply(target, arguments); };
      return fn;
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}

module.exports = { createFakeWebGL };
