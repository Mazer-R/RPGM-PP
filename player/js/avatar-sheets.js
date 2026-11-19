// The avatar's pictures: what is on each character's sheet
// (js/avatar-<character>.png) and where. Written by the tool that cuts the
// pieces; not by hand. `names` is the order of the pictures on every sheet,
// in rows of `columns` cells of `cell` size; `feet` is where the middle of
// the body's feet is in a cell and `body` the body's own size.
(function () {
  'use strict';
  globalThis.__avatarSheets = {
    "names": [
      "base",
      "burlap-sack",
      "pyjamas",
      "tuxedo",
      "helmet",
      "wizard-hat",
      "hood",
      "pork-pie-hat",
      "white-wig",
      "nightcap",
      "popcorn-bucket-hat",
      "crown",
      "tinfoil-hat",
      "goatee",
      "scholar-glasses",
      "sword",
      "staff",
      "bow",
      "quill",
      "beer-mug",
      "popcorn-bucket",
      "sceptre",
      "spoon",
      "shovel",
      "shield",
      "cape",
      "quiver",
      "wings",
      "two-shields",
      "heart",
      "perfectly-normal-scarf",
      "burlap-sack-erase",
      "pyjamas-erase",
      "tuxedo-erase",
      "helmet-erase",
      "wizard-hat-erase",
      "hood-erase",
      "pork-pie-hat-erase",
      "white-wig-erase",
      "nightcap-erase",
      "popcorn-bucket-hat-erase",
      "crown-erase",
      "tinfoil-hat-erase"
    ],
    "sheets": {
      "potato": {
        "cell": [
          255,
          215
        ],
        "columns": 8,
        "feet": [
          129,
          209
        ],
        "body": [
          130,
          168
        ]
      },
      "wrinkled": {
        "cell": [
          219,
          188
        ],
        "columns": 8,
        "feet": [
          107,
          185
        ],
        "body": [
          126,
          152
        ]
      },
      "fry": {
        "cell": [
          258,
          218
        ],
        "columns": 8,
        "feet": [
          128,
          216
        ],
        "body": [
          69,
          204
        ]
      },
      "chip": {
        "cell": [
          222,
          190
        ],
        "columns": 8,
        "feet": [
          111,
          189
        ],
        "body": [
          143,
          160
        ]
      },
      "sweet-potato": {
        "cell": [
          235,
          189
        ],
        "columns": 8,
        "feet": [
          115,
          187
        ],
        "body": [
          107,
          168
        ]
      },
      "avocado": {
        "cell": [
          235,
          193
        ],
        "columns": 8,
        "feet": [
          117,
          185
        ],
        "body": [
          127,
          168
        ]
      },
      "golden-potato": {
        "cell": [
          255,
          215
        ],
        "columns": 8,
        "feet": [
          129,
          209
        ],
        "body": [
          130,
          168
        ]
      }
    }
  };
})();
