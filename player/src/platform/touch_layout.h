// The layout of the on-screen touch controls: which controls there are,
// where, how big, and which key each presses. A layout is plain data; it is
// kept as a small text file in a game's save folder, so each game can have
// the buttons it needs. This file knows nothing about fingers or drawing.
#pragma once

#include <string>
#include <vector>

namespace mvp {

// One control. Lengths are in units of the screen's shorter side, so a
// layout fits a screen of any size. x counts from the left edge when
// positive and from the right edge when negative; y from the top when
// positive and from the bottom when negative. A control therefore stays
// with the edge it was put near. key_code is the browser key code the
// control presses; 0 is the direction pad.
struct TouchControl {
  float x, y, size;
  int key_code;
};

// The pad on the left; confirm, cancel and dash on the right.
std::vector<TouchControl> DefaultTouchLayout();

// The text form, one control per line: "<key> <x> <y> <size>", where <key>
// is a key code or the word "pad". Lines starting with # are comments.
// Reading skips lines that are not a control.
std::string FormatTouchLayout(const std::vector<TouchControl>& layout);
std::vector<TouchControl> ParseTouchLayout(const std::string& text);

// A short name for a key, in capital letters and digits: "T", "ENTER";
// "PAD" for 0. Empty for a key without a name.
std::string TouchKeyLabel(int key_code);

// The keys a new control can be given, in the order they are offered.
const std::vector<int>& TouchKeyChoices();

}  // namespace mvp
