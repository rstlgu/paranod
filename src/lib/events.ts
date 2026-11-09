/**
 * Sistema di eventi globali per comunicazione tra componenti
 */

type EventCallback = () => void;

class EventEmitter {
  private events: Map<string, Set<EventCallback>> = new Map();

  on(event: string, callback: EventCallback) {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(callback);
  }

  off(event: string, callback: EventCallback) {
    this.events.get(event)?.delete(callback);
  }

  emit(event: string) {
    this.events.get(event)?.forEach((callback) => callback());
  }
}

export const eventBus = new EventEmitter();

// Eventi disponibili
export const EVENTS = {
  WORKSPACE_CREATED: 'workspace:created',
  WORKSPACE_UPDATED: 'workspace:updated',
  WORKSPACE_DELETED: 'workspace:deleted'
} as const;
