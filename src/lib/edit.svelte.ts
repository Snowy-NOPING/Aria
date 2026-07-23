import type { TrackMeta } from "./player.svelte";

/** Which track (if any) the tag editor is currently open for. */
class EditStore {
  target = $state<TrackMeta | null>(null);

  open(track: TrackMeta) {
    this.target = track;
  }
  close() {
    this.target = null;
  }
}

export const edit = new EditStore();
