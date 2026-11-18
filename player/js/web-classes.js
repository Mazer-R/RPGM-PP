// The list of classes of an element: element.classList.
//
// One of the browser pieces a game's profile can switch on (engine-select.js).
// It knows nothing of the game's engine.
//
// A page's style sheets do nothing here, so a class changes nothing that is
// drawn; but scripts add and remove classes on the game's canvas (a plugin
// that asks the browser for sharp pixels does, at every resize) and must be
// able to. The list is kept in step with the element's className, which is
// what a script reads back.
(function () {
  'use strict';
  // The shared ancestor of every element: the one that has setAttribute.
  var proto = Object.getPrototypeOf(document.body);
  while (proto && !Object.prototype.hasOwnProperty.call(proto, 'setAttribute')) proto = Object.getPrototypeOf(proto);
  if (!proto || 'classList' in proto) return;

  function names(element) { return String(element.className || '').split(/\s+/).filter(Boolean); }
  function ClassList(element) { this._element = element; }
  ClassList.prototype = {
    contains: function (name) { return names(this._element).indexOf(String(name)) >= 0; },
    add: function () {
      var list = names(this._element);
      Array.prototype.forEach.call(arguments, function (name) { if (list.indexOf(String(name)) < 0) list.push(String(name)); });
      this._element.className = list.join(' ');
    },
    remove: function () {
      var gone = Array.prototype.map.call(arguments, String);
      this._element.className = names(this._element).filter(function (name) { return gone.indexOf(name) < 0; }).join(' ');
    },
    toggle: function (name, force) {
      var on = force === undefined ? !this.contains(name) : !!force;
      if (on) this.add(name); else this.remove(name);
      return on;
    },
    replace: function (from, to) {
      if (!this.contains(from)) return false;
      this.remove(from);
      this.add(to);
      return true;
    },
    item: function (index) { var list = names(this._element); return index < list.length ? list[index] : null; },
    forEach: function (fn, self) { names(this._element).forEach(fn, self); },
    toString: function () { return names(this._element).join(' '); },
    get length() { return names(this._element).length; },
    get value() { return this.toString(); },
  };
  Object.defineProperty(proto, 'classList', {
    get: function () { return this.__classList || (this.__classList = new ClassList(this)); },
    configurable: true,
  });
})();
