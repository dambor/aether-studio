
import { Collaborator, CollabEvent } from '../types';

const CHANNEL_NAME = 'codefork_collab_v1';

class CollaborationManager {
    private channel: BroadcastChannel;
    private listeners: ((event: CollabEvent) => void)[] = [];
    private currentUser: Collaborator | null = null;

    constructor() {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.channel.onmessage = (event) => {
            this.notifyListeners(event.data as CollabEvent);
        };
        
        // Handle window unload to notify others
        window.addEventListener('beforeunload', () => {
            if (this.currentUser) {
                this.broadcast({ type: 'LEAVE', userId: this.currentUser.id });
            }
        });
    }

    public registerUser(user: Collaborator) {
        this.currentUser = user;
        this.broadcast({ type: 'JOIN', user });
    }

    public getCurrentUser(): Collaborator | null {
        return this.currentUser;
    }

    public updateState(partialUser: Partial<Collaborator>) {
        if (!this.currentUser) return;
        
        this.currentUser = { ...this.currentUser, ...partialUser, lastActive: Date.now() };
        this.broadcast({ type: 'UPDATE', user: this.currentUser });
    }

    public broadcast(event: CollabEvent) {
        this.channel.postMessage(event);
    }

    public subscribe(callback: (event: CollabEvent) => void) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    private notifyListeners(event: CollabEvent) {
        this.listeners.forEach(l => l(event));
    }
}

export const collaborationService = new CollaborationManager();
