export type View =
  | "home"
  | "recent"
  | "songs"
  | "albums"
  | "album"
  | "artist"
  | "videos"
  | "playlists"
  | "playlist"
  | "queue"
  | "lyrics"
  | "settings";

interface HistoryItem {
  view: View;
  param: string | null;
}

class Nav {
  view = $state<View>("home");
  /** Detail selector: album key, artist name, or playlist id. */
  param = $state<string | null>(null);
  /** Shared library search query. */
  query = $state("");
  /** Previous view, so toggles can return where you came from. */
  prev = $state<View>("home");

  // History tracking for back/forward buttons
  history = $state<HistoryItem[]>([{ view: "home", param: null }]);
  historyIndex = $state(0);
  private navigatingHistory = false;

  go(view: View, param: string | null = null) {
    if (view !== this.view) this.prev = this.view;

    if (!this.navigatingHistory) {
      // Truncate any forward history if we were in the middle of history
      const nextHistory = this.history.slice(0, this.historyIndex + 1);
      const current = nextHistory[nextHistory.length - 1];
      
      // Only push to history if it's actually a new destination
      if (!current || current.view !== view || current.param !== param) {
        nextHistory.push({ view, param });
        this.history = nextHistory;
        this.historyIndex = this.history.length - 1;
      }
    }

    this.view = view;
    this.param = param;
  }

  /** Open a view, or if it's already open, go back to the previous one. */
  toggle(view: View) {
    if (this.view === view) {
      this.go(this.prev && this.prev !== view ? this.prev : "home");
    } else {
      this.go(view);
    }
  }

  get canGoBack() {
    return this.historyIndex > 0;
  }

  get canGoForward() {
    return this.historyIndex < this.history.length - 1;
  }

  goBack() {
    if (!this.canGoBack) return;
    this.historyIndex--;
    const item = this.history[this.historyIndex];
    this.navigatingHistory = true;
    this.go(item.view, item.param);
    this.navigatingHistory = false;
  }

  goForward() {
    if (!this.canGoForward) return;
    this.historyIndex++;
    const item = this.history[this.historyIndex];
    this.navigatingHistory = true;
    this.go(item.view, item.param);
    this.navigatingHistory = false;
  }
}

export const nav = new Nav();
