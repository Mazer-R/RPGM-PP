// Which key each of a controller's buttons presses. The buttons go by the
// names SDL's game controller layer gives them ("a", "leftshoulder", ...),
// which is also what the system's controller lists use, so a name means the
// same button on every controller. The map is plain data, kept as a small
// text file in a game's save folder, so each game can have its own. The
// direction pad and the stick always press the arrow keys and are not part
// of it.
#pragma once

#include <map>
#include <string>
#include <vector>

namespace mvp {

// The buttons that can be given a key, in the order they are listed. The two
// triggers count as buttons.
const std::vector<std::string>& MappableButtons();

// A button as printed on a controller: "A", "L1", "SELECT".
std::string ButtonLabel(const std::string& button);

class ButtonMap {
 public:
  // The standard map, which follows the engine's own gamepad defaults: A
  // confirms, B cancels, X dashes, Y opens the menu, the shoulders page.
  ButtonMap();

  // The browser key code the button presses; 0 for none.
  int KeyFor(const std::string& button) const;
  void Set(const std::string& button, int key_code);

  // The text form, one button per line: "<button> <key code>". Lines
  // starting with # are comments. Reading starts from the standard map and
  // skips lines that make no sense.
  std::string Format() const;
  static ButtonMap Parse(const std::string& text);

 private:
  std::map<std::string, int> keys_;
};

}  // namespace mvp
