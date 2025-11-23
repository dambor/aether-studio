
import { Collaborator, CollabEvent } from '../types';

class CollaborationManager {
    private channel: BroadcastChannel | null = null;
    private listeners: ((event: CollabEvent) => void)[] = [];
    private currentUser: Collaborator | null = null;
    private sessionId: string;
    private isHostUser: boolean = false;

    constructor() {
        try {
            // 1. Get Session ID from URL
            const urlParams = new URLSearchParams(window.location.search);
            let token = urlParams.get('session');
            
            // Check if we own this session (persisted in local storage)
            const storedHostSession = localStorage.getItem('aether_host_session');

            if (!token) {
                // Generate new Session
                token = Math.random().toString(36).substring(2, 15);
                this.sessionId = token;
                this.isHostUser = true;
                localStorage.setItem('aether_host_session', token);
            } else {
                this.sessionId = token;
                // If the URL token matches what we stored previously, we are the host returning
                if (storedHostSession === token) {
                    this.isHostUser = true;
                } else {
                    this.isHostUser = false;
                }
            }

            // 2. Connect to a specific channel for this session
            try {
                this.channel = new BroadcastChannel(`aether_session_${this.sessionId}`);
                
                this.channel.onmessage = (event) => {
                    this.notifyListeners(event.data as CollabEvent);
                };
            } catch (err) {
                console.warn("BroadcastChannel not supported or blocked. Collaboration features disabled.", err);
            }
            
            // Handle window unload to notify others
            window.addEventListener('beforeunload', () => {
                if (this.currentUser) {
                    this.broadcast({ type: 'LEAVE', userId: this.currentUser.id });
                }
            });
        } catch (e) {
            console.error("CollaborationManager failed to initialize:", e);
            this.sessionId = 'offline';
        }
    }

    public getSessionId() {
        return this.sessionId;
    }

    public isHost() {
        return this.isHostUser;
    }

    // Force this client to become host (useful for manual override)
    public claimHost() {
        this.isHostUser = true;
        localStorage.setItem('aether_host_session', this.sessionId);
    }

    public registerUser(user: Collaborator) {
        this.currentUser = user;
        // If we are joining, we announce ourselves AND request the current state
        this.broadcast({ type: 'JOIN', user });
        if (!this.isHostUser) {
            this.broadcast({ type: 'JOIN_REQUEST', user });
        }
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
        if (this.channel) {
            try {
                this.channel.postMessage(event);
            } catch (e) {
                console.error("Failed to broadcast message:", e);
            }
        }
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
