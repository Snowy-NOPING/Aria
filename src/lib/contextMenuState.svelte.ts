export interface MenuItem {
  label: string;
  action?: () => void;
  disabled?: boolean;
  submenu?: MenuItem[];
  icon?: string;
  checked?: boolean;
  isDanger?: boolean;
}

class ContextMenuState {
  visible = $state(false);
  x = $state(0);
  y = $state(0);
  items = $state<MenuItem[]>([]);

  show(clientX: number, clientY: number, newItems: MenuItem[]) {
    this.x = clientX;
    this.y = clientY;
    this.items = newItems;
    this.visible = true;
  }

  close() {
    this.visible = false;
  }
}

export const contextMenu = new ContextMenuState();
