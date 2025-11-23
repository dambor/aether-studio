
export enum FileType {
    FILE = 'file',
    DIRECTORY = 'dir'
}

export interface FileNode {
    name: string;
    path: string;
    type: FileType;
    url?: string;
    content?: string;
    children?: FileNode[];
    isOpen?: boolean; // For directories
    isLoading?: boolean;
    status?: 'modified' | 'staged' | null;
    isLocal?: boolean; // If true, do not fetch from GitHub
    handle?: FileSystemHandle; // For local file system access
}

export interface ChatMessage {
    role: 'user' | 'model';
    text: string;
    timestamp: Date;
    isError?: boolean;
    isToolUse?: boolean; // To style tool execution logs differently
    image?: string; // Base64 image
}

export interface Collaborator {
    id: string;
    name: string;
    color: string;
    file?: string; // Path of the file they are editing
    cursor?: { lineNumber: number; column: number };
    content?: string; // Snapshot of the content they are seeing/typing
    lastActive?: number;
}

export const AI_AGENT_COLLABORATOR: Collaborator = {
    id: 'gemini-agent-001',
    name: 'Gemini Agent',
    color: '#8AB4F8', // Google Blue
    lastActive: 0
};

export type CollabEvent = 
    | { type: 'JOIN'; user: Collaborator } // Broadcast presence
    | { type: 'JOIN_REQUEST'; user: Collaborator } // Guest asking for state
    | { type: 'SYNC_INIT'; fileTree: FileNode[] } // Host sending full state
    | { type: 'LEAVE'; userId: string }
    | { type: 'UPDATE'; user: Collaborator }
    | { type: 'HEARTBEAT'; userId: string }
    | { type: 'SYNC_FILES'; fileTree: FileNode[] };

export interface TerminalLine {
    type: 'input' | 'output' | 'system';
    content: string;
}

export interface GitHubContent {
    name: string;
    path: string;
    type: string;
    url: string;
    download_url: string | null;
}

export interface GitHubRepo {
    id: number;
    name: string;
    full_name: string;
    private: boolean;
    html_url: string;
    description: string | null;
    default_branch: string;
    updated_at: string;
}

export interface ToolHandler {
    listFiles: () => Promise<string[]>;
    readFile: (path: string) => Promise<string>;
    updateFile: (path: string, content: string) => Promise<void>;
    runTerminal: (cmd: string) => Promise<string>;
    listMcpServers?: () => Promise<string>;
    executeMcpTool?: (serverName: string, command: string, args: any) => Promise<string>;
}

export interface KubeConfig {
    apiVersion: string;
    clusters: Array<{
        name: string;
        cluster: {
            server: string;
            "certificate-authority-data"?: string;
        };
    }>;
    contexts: Array<{
        name: string;
        context: {
            cluster: string;
            user: string;
        };
    }>;
    "current-context": string;
    users: Array<{
        name: string;
        user: {
            token?: string;
            "client-certificate-data"?: string;
            "client-key-data"?: string;
        };
    }>;
}

export interface K8sResource {
    kind: string;
    metadata: {
        name: string;
        namespace: string;
        creationTimestamp: string;
    };
    status?: any;
}

export interface K8sContext {
    name: string;
    cluster: string;
    user: string;
}

// --- New Integrations ---

export interface DockerRepo {
    user: string;
    name: string;
    namespace: string;
    description: string;
    pull_count: number;
    last_updated: string;
    tags?: string[];
}

export interface MCPServerConfig {
    command: string;
    args: string[];
    env?: Record<string, string>;
}

export interface AetherConfig {
    github?: {
        token: string;
    };
    docker?: {
        user: string;
        token: string;
    };
    mcp?: {
        mcpServers: Record<string, MCPServerConfig>;
    };
}
