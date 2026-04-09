import { triflareVolumes } from './01-core.js';

Object.assign(triflareVolumes.prototype, {
  // --- Advanced Block Visibility Toggle ---

  toggleAdvancedBlocks() {
    this._advancedBlocksHidden = !this._advancedBlocksHidden;
    try {
      if (Scratch.vm && Scratch.vm.extensionManager) {
        Scratch.vm.extensionManager.refreshBlocks();
      }
    } catch (_) {
      // Ignore if refreshBlocks is unavailable in this runtime
    }
  },
});

Scratch.extensions.register(new triflareVolumes());
