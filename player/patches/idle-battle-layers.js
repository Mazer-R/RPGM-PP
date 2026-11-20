// Patch "idleBattleLayers": the layers of a battle's backdrop that cannot be
// seen are not drawn.
//
// A battle's backdrop is three pictures the size of the screen, one over
// the other: a picture of the map taken as the battle begins, blurred, and
// the battle's two backgrounds, the floor and the wall of the place. Every
// one is drawn at every frame, and for the graphics processor of a handheld
// each is the difference of about five frames per second in a battle that
// waits for a command. Two cases are common in which some of them show
// nothing:
//
//   - A game that gives its battles no backgrounds still has both, as empty
//     pictures. With this patch a background that was never loaded from a
//     file and has nothing in it (every pixel looked at, once) is not drawn.
//   - A game with a solid floor never shows the picture of the map behind
//     it. With this patch the picture of the map is hidden while one of the
//     two backgrounds is shown, is not faded, covers the whole screen and
//     is solid everywhere. Whether it is solid is found out once, from a
//     small copy of it: 32 by 32 samples, every one of which must have no
//     see-through at all.
//
// As soon as the reason is gone (a background fades or is hidden, the game
// gives the sprite another picture) the layer is drawn again. A layer the
// game itself has hidden is left hidden.
//
// It never edits game files. To turn it off for one game, name it
// under "off" in that game's save/mvplayer-patches.json; for every game,
// remove its line from patches/index.json or start the player with
// --no-patches. Its counters are in player.patchStats.idleBattleLayers.
player.patches.idleBattleLayers = function () {
  var SIDE = 32;
  var stats = { hidden: 0, shownAgain: 0, emptyHidden: 0, emptyShownAgain: 0, backgroundsLookedAt: 0 };
  player.patchStats.idleBattleLayers = stats;
  var Battle = globalThis.Spriteset_Battle;
  if (!Battle || typeof Battle.prototype.update !== 'function') return;
  var sample = null;

  // What a bitmap is drawn from, without making a canvas of it: in MV 1.6
  // asking for `_canvas` makes one.
  function sourceOf(bitmap) {
    if (bitmap._image) return bitmap._image;
    if (bitmap.__canvas) return bitmap.__canvas;
    return Object.prototype.hasOwnProperty.call(bitmap, '_canvas') ? bitmap._canvas : null;
  }
  function solid(bitmap) {
    if (bitmap.__solid !== undefined) return bitmap.__solid;
    var answer = false;
    try {
      var source = sourceOf(bitmap);
      if (source && globalThis.document) {
        if (!sample) { sample = document.createElement('canvas'); sample.width = SIDE; sample.height = SIDE; }
        var context = sample.getContext('2d');
        context.clearRect(0, 0, SIDE, SIDE);
        // A little larger than the samples, so that its edges, which a
        // smaller copy mixes with the nothing around it, fall outside.
        context.drawImage(source, 0, 0, bitmap.width, bitmap.height, -2, -2, SIDE + 4, SIDE + 4);
        var data = context.getImageData(0, 0, SIDE, SIDE).data;
        answer = true;
        for (var i = 3; i < data.length; i += 4) if (data[i] !== 255) { answer = false; break; }
        stats.backgroundsLookedAt++;
      }
    } catch (error) { answer = false; }
    bitmap.__solid = answer;
    return answer;
  }
  // True for a picture that was never loaded from a file and has nothing in
  // it: what the engine makes when a battle is given no background.
  function empty(bitmap) {
    if (bitmap.__empty !== undefined) return bitmap.__empty;
    var answer = false;
    try {
      var canvas = bitmap.__canvas || (Object.prototype.hasOwnProperty.call(bitmap, '_canvas') ? bitmap._canvas : null);
      if (!bitmap._url && !bitmap._image && canvas && typeof canvas.getContext === 'function') {
        var data = canvas.getContext('2d').getImageData(0, 0, bitmap.width, bitmap.height).data;
        answer = true;
        for (var i = 3; i < data.length; i += 4) if (data[i] !== 0) { answer = false; break; }
        stats.backgroundsLookedAt++;
      }
    } catch (error) { answer = false; }
    bitmap.__empty = answer;
    return answer;
  }
  function ready(sprite) {
    var bitmap = sprite && sprite.bitmap;
    return !!bitmap && typeof bitmap.isReady === 'function' && bitmap.isReady();
  }
  // Hides a background while its picture is empty; shows it again when the
  // game gives it another.
  function restEmpty(sprite) {
    if (!sprite) return;
    var isEmpty = ready(sprite) && empty(sprite.bitmap);
    if (isEmpty && sprite.visible) { sprite.visible = false; sprite.__hiddenByPlayer = true; stats.emptyHidden++; }
    else if (!isEmpty && sprite.__hiddenByPlayer) { sprite.visible = true; sprite.__hiddenByPlayer = false; stats.emptyShownAgain++; }
  }
  function covers(sprite) {
    if (!sprite || !sprite.visible || sprite.opacity !== 255) return false;
    var bitmap = sprite.bitmap;
    if (!bitmap || typeof bitmap.isReady !== 'function' || !bitmap.isReady() || typeof sprite.getBounds !== 'function') return false;
    var at = sprite.getBounds(), screen = globalThis.Graphics;
    if (!screen || !(at.x <= 0 && at.y <= 0 && at.x + at.width >= screen.width && at.y + at.height >= screen.height)) return false;
    return solid(bitmap);
  }

  var update = Battle.prototype.update;
  Battle.prototype.update = function () {
    var result = update.apply(this, arguments);
    restEmpty(this._back1Sprite);
    restEmpty(this._back2Sprite);
    var snapshot = this._backgroundSprite;
    if (snapshot) {
      var covered = covers(this._back1Sprite) || covers(this._back2Sprite);
      if (covered && snapshot.visible) { snapshot.visible = false; snapshot.__hiddenByPlayer = true; stats.hidden++; }
      else if (!covered && snapshot.__hiddenByPlayer) { snapshot.visible = true; snapshot.__hiddenByPlayer = false; stats.shownAgain++; }
    }
    return result;
  };
};
