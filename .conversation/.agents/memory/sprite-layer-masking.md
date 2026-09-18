---
name: Sprite layer masking
description: Rules for using full-character sprite sheets as independent wardrobe layers.
---

Full-character sheets used as wardrobe layers must be masked to pixels that uniquely belong to the item, not merely cropped and made non-white.

**Why:** Cropping a white-background character sheet preserved head and hair outlines, so adding an accessory could overwrite an independently rendered hairstyle.

**How to apply:** Use distinctive accessory-color seeds and a small dilation for nearby outlines; keep the layer order body, hair, then accessory.