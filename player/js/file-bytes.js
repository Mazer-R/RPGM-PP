// Blocks of bytes that stand for a file.
//
// The engine sometimes reads a file's bytes itself only to look at its
// start: a sound file, to find the loop points in its header; an
// "encrypted" image or sound, to unscramble its first bytes. Handing over a
// whole file for that would hold every image and song in script memory. The
// engine is given the start of the file instead, and that block is
// remembered here as standing for the file, so that when the engine later
// hands the block on (to be shown or played) native code can be told which
// file to read.
//
// For an encrypted file the engine first cuts a 16-byte marker off the block
// and then unscrambles the 16 bytes that follow. A cut made from a block
// that stands for a file stands for the same file from further in, and the
// bytes at its start are the file's true first bytes; fileBehind() passes
// those to native code (player.fileHead), which then reads the file from
// that point with those bytes in place. The key is never needed here: the
// engine's own unscrambling is what is used.
(function () {
  'use strict';
  var browser = globalThis.__browser = globalThis.__browser || {};

  var origins = new WeakMap(); // ArrayBuffer -> { path, offset }
  var slice = ArrayBuffer.prototype.slice;
  // How many of the true first bytes native code is told: more than any
  // scrambled part, and enough to hold an image's size.
  var HEAD_BYTES = 64;

  // Marks `bytes` (an ArrayBuffer) as the start of the file at `path`.
  browser.bytesStandFor = function (bytes, path) {
    origins.set(bytes, { path: path, offset: 0 });
    return bytes;
  };

  ArrayBuffer.prototype.slice = function (begin) {
    var cut = slice.apply(this, arguments);
    var origin = origins.get(this);
    if (origin) {
      var length = this.byteLength;
      var from = begin === undefined ? 0 : Math.trunc(Number(begin)) || 0;
      from = from < 0 ? Math.max(length + from, 0) : Math.min(from, length);
      origins.set(cut, { path: origin.path, offset: origin.offset + from });
    }
    return cut;
  };

  // The path of the file that `bytes` (an ArrayBuffer or a view over one)
  // stands for, or null. If the block was cut from further into the file,
  // native code is told the file's true first bytes.
  browser.fileBehind = function (bytes) {
    if (ArrayBuffer.isView(bytes)) bytes = bytes.byteOffset === 0 ? bytes.buffer : null;
    var origin = bytes ? origins.get(bytes) : null;
    if (!origin) return null;
    if (origin.offset > 0) player.fileHead(origin.path, origin.offset, slice.call(bytes, 0, HEAD_BYTES));
    return origin.path;
  };
})();
