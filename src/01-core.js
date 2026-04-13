// CobaltVDisk
// Author: Triflare
// Initialized by npm run init

/**
 * Blank starter template.
 *
 * Usage example:
 * - Add a block object in getInfo().blocks.
 * - Add the matching method on the class.
 */
/* global Scratch */
class TurboWarpExtension {
  getInfo() {
    return {
      id: "tfCobaltvdisk",
      name: Scratch.translate("CobaltVDisk"),
      blocks: [],
    };
  }
}

Scratch.extensions.register(new TurboWarpExtension());
