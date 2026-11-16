#!/usr/bin/env python3
"""Makes an "encrypted" copy of an RPG Maker MV game, for testing the player.

RPG Maker MV's deployment can encrypt images and sounds: each file gets a
16-byte marker in front, its own first 16 bytes are XORed with a key, and it
is renamed (.png -> .rpgmvp, .ogg -> .rpgmvo). The key and two switches go
into data/System.json. This script does the same to a copy of a game that
was shipped unencrypted, so that the player's handling of such games can be
checked with a game that is known to work.

Usage: encrypt-game.py <game-www-dir> <new-www-dir>
The new folder must not exist. The original is not changed.
"""
import json
import os
import shutil
import sys

MARKER = bytes.fromhex("5250474d560000000003010000000000")
KEY = "d41d8cd98f00b204e9800998ecf8427e"
# The engine itself never treats this one as encrypted.
PLAIN = {"img/system/Window.png"}
RENAMED = {".png": ".rpgmvp", ".ogg": ".rpgmvo"}


def main(source, target):
    shutil.copytree(source, target, ignore=shutil.ignore_patterns("save"))
    key = bytes.fromhex(KEY)
    count = 0
    for top in ("img", "audio"):
        for folder, _, names in os.walk(os.path.join(target, top)):
            for name in names:
                path = os.path.join(folder, name)
                base, ext = os.path.splitext(path)
                if ext.lower() not in RENAMED or os.path.relpath(path, target).replace(os.sep, "/") in PLAIN:
                    continue
                with open(path, "rb") as file:
                    data = file.read()
                head = bytes(a ^ b for a, b in zip(data[:16], key))
                with open(base + RENAMED[ext.lower()], "wb") as file:
                    file.write(MARKER + head + data[16:])
                os.remove(path)
                count += 1
    system_path = os.path.join(target, "data", "System.json")
    with open(system_path, encoding="utf-8") as file:
        system = json.load(file)
    system.update(hasEncryptedImages=True, hasEncryptedAudio=True, encryptionKey=KEY)
    with open(system_path, "w", encoding="utf-8") as file:
        json.dump(system, file, ensure_ascii=False)
    print(f"{count} files encrypted in {target}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
