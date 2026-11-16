#include "platform/button_map.h"

#include <sstream>

namespace mvp {
namespace {

struct Button {
  const char* name;
  const char* label;
  int standard_key;
};
const Button kButtons[] = {
    {"a", "A", 90},          {"b", "B", 88},              {"x", "X", 16},
    {"y", "Y", 27},          {"start", "START", 13},      {"back", "SELECT", 27},
    {"leftshoulder", "L1", 33}, {"rightshoulder", "R1", 34}, {"lefttrigger", "L2", 0},
    {"righttrigger", "R2", 0},  {"leftstick", "L3", 0},      {"rightstick", "R3", 0},
};

}  // namespace

const std::vector<std::string>& MappableButtons() {
  static const std::vector<std::string> names = [] {
    std::vector<std::string> all;
    for (const Button& button : kButtons) all.push_back(button.name);
    return all;
  }();
  return names;
}

std::string ButtonLabel(const std::string& button) {
  for (const Button& known : kButtons) {
    if (button == known.name) return known.label;
  }
  return "";
}

ButtonMap::ButtonMap() {
  for (const Button& button : kButtons) keys_[button.name] = button.standard_key;
}

int ButtonMap::KeyFor(const std::string& button) const {
  auto found = keys_.find(button);
  return found == keys_.end() ? 0 : found->second;
}

void ButtonMap::Set(const std::string& button, int key_code) {
  if (keys_.count(button)) keys_[button] = key_code;
}

std::string ButtonMap::Format() const {
  std::string text = "# Which key each controller button presses: button, browser key code\n"
                     "# (0 for none). Buttons go by SDL's game controller names.\n";
  for (const Button& button : kButtons) text += std::string(button.name) + " " + std::to_string(KeyFor(button.name)) + "\n";
  return text;
}

ButtonMap ButtonMap::Parse(const std::string& text) {
  ButtonMap map;
  std::istringstream lines(text);
  std::string line;
  while (std::getline(lines, line)) {
    std::istringstream words(line);
    std::string button, key;
    if (!(words >> button >> key)) continue;
    if (key.size() > 3 || key.find_first_not_of("0123456789") != std::string::npos) continue;
    int key_code = std::stoi(key);
    if (key_code > 255) continue;
    map.Set(button, key_code);
  }
  return map;
}

}  // namespace mvp
