// Synthetic benchmark for the one Canvas 2D operation that dominates the
// lighting plugin's cost: filling a large rectangle with a radial gradient
// under the additive ("lighter") composite mode. Compares canvas sizes and
// composite modes so the effect of painting the mask smaller can be judged.
// Uses the `canvas` package only; no game content.
'use strict';
const { createCanvas } = require('canvas');

function time(label, width, height, operation, gradientFill) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const runs = [];
  for (let i = 0; i < 12; i++) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    const radius = Math.min(width, height) / 2;
    let style = '#333333';
    if (gradientFill) {
      style = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, radius);
      style.addColorStop(0, '#ffffff');
      style.addColorStop(1, '#000000');
    }
    ctx.globalCompositeOperation = operation;
    ctx.fillStyle = style;
    const before = process.hrtime.bigint();
    ctx.fillRect(0, 0, width, height);
    runs.push(Number(process.hrtime.bigint() - before) / 1e6);
  }
  runs.sort((a, b) => a - b);
  console.log(JSON.stringify({ label, width, height, operation, gradient: gradientFill, medianMs: Math.round(runs[6] * 100) / 100 }));
}

for (const [w, h] of [[866, 630], [433, 315], [217, 158]]) {
  time('gradient fill', w, h, 'lighter', true);
  time('gradient fill', w, h, 'source-over', true);
  time('solid fill', w, h, 'lighter', false);
  time('solid fill', w, h, 'source-over', false);
}
