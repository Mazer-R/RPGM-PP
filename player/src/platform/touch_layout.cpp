#include "platform/touch_layout.h"

#include <cstdio>
#include <sstream>

namespace mvp {
namespace {

struct NamedKey {
  int key_code;
  const char* name;
};
const NamedKey kNamedKeys[] = {
    {13, "ENTER"}, {27, "ESC"},  {32, "SPACE"}, {9, "TAB"},   {16, "SHIFT"}, {17, "CTRL"},
    {18, "ALT"},   {33, "PGUP"}, {34, "PGDN"},  {45, "INS"},  {8, "BACK"},   {0, "PAD"},
};

bool IsLetterOrDigit(int key_code) { return (key_code >= 65 && key_code <= 90) || (key_code >= 48 && key_code <= 57); }

}  // namespace

std::vector<TouchControl> DefaultTouchLayout() {
  // The pad is for a thumb that is not being looked at: a fifth of the
  // screen's shorter side in radius, more than twice a button.
  const float pad = 0.21f, button = 0.085f, margin = 0.04f;
  return {
      {margin + pad, -(margin + pad), pad, kTouchStick},
      // Confirm under the thumb, cancel to its lower left, dash above.
      {-(margin + button), -(margin + button * 3.0f), button, 90},
      {-(margin + button * 3.2f), -(margin + button), button, 88},
      {-(margin + button), -(margin + button * 5.6f), button * 0.8f, 16},
  };
}

std::string FormatTouchLayout(const std::vector<TouchControl>& layout, bool shown) {
  std::string text = "# On-screen touch controls: key (a key code, pad or stick), x, y, size.\n"
                     "# Lengths are in units of the screen's shorter side; negative x and y\n"
                     "# count from the right and the bottom.\n";
  for (const TouchControl& control : layout) {
    char line[96];
    std::string key = control.key_code == kTouchPad ? "pad" : control.key_code == kTouchStick ? "stick" : std::to_string(control.key_code);
    std::snprintf(line, sizeof line, "%s %.4f %.4f %.4f\n", key.c_str(), control.x, control.y, control.size);
    text += line;
  }
  if (!shown) text += "controls off\n";
  return text;
}

bool TouchControlsShown(const std::string& text) {
  std::istringstream lines(text);
  std::string line;
  while (std::getline(lines, line)) {
    if (line == "controls off") return false;
  }
  return true;
}

std::vector<TouchControl> ParseTouchLayout(const std::string& text) {
  std::vector<TouchControl> layout;
  std::istringstream lines(text);
  std::string line;
  while (std::getline(lines, line)) {
    std::istringstream words(line);
    std::string key;
    TouchControl control = {0, 0, 0, 0};
    if (!(words >> key >> control.x >> control.y >> control.size)) continue;
    if (key == "stick") {
      control.key_code = kTouchStick;
    } else if (key != "pad") {
      if (key.empty() || key.size() > 3 || key.find_first_not_of("0123456789") != std::string::npos) continue;
      control.key_code = std::stoi(key);
      if (control.key_code < 1 || control.key_code > 255) continue;
    }
    if (control.size <= 0.0f || control.size > 1.0f) continue;
    layout.push_back(control);
  }
  return layout;
}

std::string TouchKeyLabel(int key_code) {
  if (key_code == kTouchStick) return "STICK";
  if (IsLetterOrDigit(key_code)) return std::string(1, static_cast<char>(key_code));
  for (const NamedKey& key : kNamedKeys) {
    if (key.key_code == key_code) return key.name;
  }
  return "";
}

const std::vector<int>& TouchKeyChoices() {
  static const std::vector<int> choices = [] {
    std::vector<int> keys;
    for (int key = 65; key <= 90; key++) keys.push_back(key);
    for (int key = 48; key <= 57; key++) keys.push_back(key);
    for (const NamedKey& key : kNamedKeys) keys.push_back(key.key_code);
    return keys;
  }();
  return choices;
}

}  // namespace mvp
