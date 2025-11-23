
import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import CodeEditor from './components/Editor';
import Chat from './components/Chat';
import XtermTerminal from './components/Terminal';
import Preview from './components/Preview';
import { FileIcon, SearchIcon, SourceControlIcon, KubernetesIcon, DockerIcon, SettingsIcon, ServerIcon, EyeIcon, ShareIcon, UserPlusIcon, MessageSquareIcon } from './components/Icons';
import { FileNode, Collaborator, ToolHandler, AI_AGENT_COLLABORATOR, AetherConfig, FileType } from './types';
import { fetchFileContent, pushFileUpdate, setGitHubToken } from './services/githubService';
import { collaborationService } from './services/collaborationService';
import { loadMcpConfig, getActiveMcpServers, generateMcpToolDescription, executeMcpTool } from './services/mcpService';
import { saveFileToDisk, readFileFromDisk } from './services/fileHandleService';
import { ShellService } from './services/shellService';
import { initializeKubeConfig, loadKubeConfig } from './services/kubernetesService';

// Utilities to generate random user identity
const COLORS = ['#FF5733', '#33FF57', '#3357FF', '#F033FF', '#33FFF5', '#FF33A8', '#FF8F33', '#8F33FF'];
const NAMES = ['Coder', 'Hacker', 'Dev', 'Engineer', 'Architect', 'Ninja', 'Guru', 'Wizard'];

const generateUser = (): Collaborator => {
    const id = Math.random().toString(36).substr(2, 9);
    const randomName = NAMES[Math.floor(Math.random() * NAMES.length)] + ' ' + Math.floor(Math.random() * 100);
    const randomColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    
    return {
        id,
        name: randomName,
        color: randomColor,
        lastActive: Date.now()
    };
};

function App() {
    // Initialize File Tree with a persistent local 'agent_temp' directory for generated code
    const [fileTree, setFileTree] = useState<FileNode[]>([
        {
            name: 'agent_temp',
            path: 'agent_temp',
            type: FileType.DIRECTORY,
            children: [],
            isOpen: true,
            isLocal: true // Mark as local so Sidebar doesn't try to fetch from GitHub
        }
    ]);
    const [activeFile, setActiveFile] = useState<FileNode | null>(null);
    const [activeFileContent, setActiveFileContent] = useState<string>("");
    const [showChat, setShowChat] = useState(true);
    const [showPreview, setShowPreview] = useState(false);
    const [currentUser, setCurrentUser] = useState<Collaborator | null>(null);
    const [activeView, setActiveView] = useState<'explorer' | 'git' | 'k8s' | 'docker' | 'mcp' | 'settings'>('explorer');
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [aetherConfig, setAetherConfig] = useState<AetherConfig | null>(null);
    
    // Session State
    const [sessionId, setSessionId] = useState<string>('');
    const [isGuest, setIsGuest] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    
    // Shell Service State
    const [shellService, setShellService] = useState<ShellService | null>(null);

    // Refs for Tool Handler access to latest state
    const fileTreeRef = useRef(fileTree);
    const activeFileRef = useRef(activeFile);
    const activeContentRef = useRef(activeFileContent);
    const shellRef = useRef<ShellService | null>(null);
    
    // Ref to track last requested file to prevent race conditions
    const lastRequestedFile = useRef<string | null>(null);

    useEffect(() => {
        fileTreeRef.current = fileTree;
        activeFileRef.current = activeFile;
        activeContentRef.current = activeFileContent;
        // Update shell context
        if (shellService) shellService.updateFileTree(fileTree);
    }, [fileTree, activeFile, activeFileContent, shellService]);

    useEffect(() => {
        // Initialize User Identity
        const user = generateUser();
        setCurrentUser(user);

        // Session Management
        const sid = collaborationService.getSessionId();
        setSessionId(sid);
        
        // Update URL without reload to reflect session
        try {
            const url = new URL(window.location.href);
            // Only attempt to modify history if we are in a standard environment
            // Blob/Sandboxed environments often block this
            if (!url.searchParams.has('session')) {
                try {
                    url.searchParams.set('session', sid);
                    window.history.replaceState({}, '', url.toString());
                } catch(e) {
                     console.warn("Unable to update URL state (sandbox restriction)");
                }
            } else {
                // If URL has session, check if we are Host or Guest
                if (!collaborationService.isHost()) {
                    setIsGuest(true);
                    setIsConnecting(true); // Block UI until we receive SYNC_INIT
                } else {
                    console.log("Welcome back, Host.");
                    setIsGuest(false);
                    setIsConnecting(false);
                }
            }
        } catch (e) {
            console.warn("Could not access URL state", e);
        }

        // Initialize Shell
        const shell = new ShellService(fileTree, setFileTree);
        setShellService(shell);
        shellRef.current = shell;
        
        // Auto-load Kubeconfig if available in localStorage
        // We wrap this in a timeout to ensure js-yaml CDN is loaded
        const initKube = () => {
            try {
                const loaded = initializeKubeConfig();
                if (loaded && shellRef.current) {
                    shellRef.current.execute('echo "Welcome back! Kubeconfig loaded from storage."');
                } else {
                    // Retry once if CDN was slow
                     setTimeout(() => initializeKubeConfig(), 1000);
                }
            } catch (e) {
                console.warn("Kubeconfig init failed", e);
            }
        };
        setTimeout(initKube, 500);
        
        // Listen for file sync events from other collaborators (or Agent)
        const unsubscribe = collaborationService.subscribe((event) => {
            
            // --- HOST LOGIC: A new user joined, send them the state ---
            if (event.type === 'JOIN_REQUEST') {
                console.log(`User ${event.user.name} requesting sync. Sending state...`);
                // We broadcast our entire file tree to the new user
                collaborationService.broadcast({ 
                    type: 'SYNC_INIT', 
                    fileTree: fileTreeRef.current 
                });
            }

            // --- GUEST LOGIC: Receive initial state from Host ---
            if (event.type === 'SYNC_INIT') {
                console.log("Received Initial State from Host.");
                setFileTree(event.fileTree);
                setIsConnecting(false); // Unblock UI
                if (shellRef.current) shellRef.current.updateFileTree(event.fileTree);
            }

            // --- UPDATE LOGIC: Receive updates from Agent or Peers ---
            if (event.type === 'SYNC_FILES') {
                console.log("Received file tree update from peer.");
                
                // CRITICAL: Merge Strategy
                setFileTree(prevTree => {
                    const mergeNodes = (local: FileNode[], remote: FileNode[]): FileNode[] => {
                        const merged: FileNode[] = [];
                        
                        // Map local nodes for easy lookup
                        const localMap = new Map(local.map(n => [n.path, n]));
                        
                        remote.forEach(remoteNode => {
                            const localNode = localMap.get(remoteNode.path);
                            
                            if (localNode) {
                                // Node exists locally
                                const mergedNode = {
                                    ...remoteNode, // Take remote data (content updates)
                                    handle: localNode.handle, // PRESERVE LOCAL DISK HANDLE
                                    isLocal: localNode.isLocal,
                                    isOpen: localNode.isOpen // Preserve UI state
                                };
                                
                                if (remoteNode.children && localNode.children) {
                                    mergedNode.children = mergeNodes(localNode.children, remoteNode.children);
                                }
                                merged.push(mergedNode);
                                localMap.delete(remoteNode.path);
                            } else {
                                // New node from remote (e.g. created by Agent)
                                merged.push(remoteNode);
                            }
                        });
                        
                        // Add remaining local nodes that remote doesn't know about
                        localMap.forEach(node => merged.push(node));
                        
                        return merged;
                    };
                    
                    return mergeNodes(prevTree, event.fileTree);
                });
            }
        });
        
        return () => unsubscribe();
    }, []);

    // --- AUTO-DETECT .kube/config ---
    useEffect(() => {
        const checkForKubeConfig = async () => {
            const findConfig = async (nodes: FileNode[]) => {
                for (const node of nodes) {
                    if (node.name === '.kube' && node.type === FileType.DIRECTORY && node.children) {
                        const configFile = node.children.find(c => c.name === 'config');
                        if (configFile) {
                            console.log("Auto-detected .kube/config!");
                            let content = "";
                            if (configFile.handle) {
                                content = await readFileFromDisk(configFile);
                            } else if (configFile.content) {
                                content = configFile.content;
                            }
                            
                            if (content && !content.startsWith('//')) {
                                try {
                                    loadKubeConfig(content);
                                    if (shellRef.current) shellRef.current.execute('echo "Auto-detected and loaded .kube/config from workspace."');
                                } catch (e) { console.error("Auto-load kubeconfig failed", e); }
                            }
                            return;
                        }
                    }
                    if (node.children) await findConfig(node.children);
                }
            };
            await findConfig(fileTree);
        };
        
        checkForKubeConfig();
    }, [fileTree]);

    // Helper to traverse and update file tree state (Modified only)
    const updateFileInTree = (nodes: FileNode[], path: string, updates: Partial<FileNode>): FileNode[] => {
        return nodes.map(node => {
            if (node.path === path) {
                return { ...node, ...updates };
            }
            if (node.children) {
                return { ...node, children: updateFileInTree(node.children, path, updates) };
            }
            return node;
        });
    };

    // Robust Helper to Create or Update nodes in the tree
    const upsertPathInTree = (nodes: FileNode[], pathParts: string[], fullPath: string, content: string): FileNode[] => {
        const [currentPart, ...rest] = pathParts;
        
        const existingNodeIndex = nodes.findIndex(n => n.name === currentPart);
        
        if (existingNodeIndex !== -1) {
            const existingNode = nodes[existingNodeIndex];
            
            if (rest.length === 0) {
                const updatedNode = { 
                    ...existingNode, 
                    content: content, 
                    status: 'modified' as const,
                    isLocal: true 
                };
                const newNodes = [...nodes];
                newNodes[existingNodeIndex] = updatedNode;
                return newNodes;
            } else {
                const newChildren = upsertPathInTree(existingNode.children || [], rest, fullPath, content);
                const updatedNode = { ...existingNode, children: newChildren };
                const newNodes = [...nodes];
                newNodes[existingNodeIndex] = updatedNode;
                return newNodes;
            }
        } else {
            if (rest.length === 0) {
                const newNode: FileNode = {
                    name: currentPart,
                    path: fullPath,
                    type: FileType.FILE,
                    content: content,
                    status: 'modified',
                    isLocal: true
                };
                return [...nodes, newNode];
            } else {
                const dirPath = fullPath.split(currentPart)[0] + currentPart;
                const newChildren = upsertPathInTree([], rest, fullPath, content);
                const newDir: FileNode = {
                    name: currentPart,
                    path: dirPath, 
                    type: FileType.DIRECTORY,
                    children: newChildren,
                    isOpen: true,
                    isLocal: true
                };
                return [...nodes, newDir];
            }
        }
    };

    const handleFileSelect = async (file: FileNode) => {
        setActiveFile(file);
        lastRequestedFile.current = file.path;

        if (file.isLocal && file.handle) {
             setActiveFileContent("// Reading from local disk...");
             try {
                 const content = await readFileFromDisk(file);
                 if (lastRequestedFile.current === file.path) {
                     setActiveFileContent(content);
                     setFileTree(prev => updateFileInTree(prev, file.path, { content: content }));
                 }
             } catch (e) {
                 setActiveFileContent("// Error reading local file.");
             }
        } else if (file.content !== undefined) {
             setActiveFileContent(file.content);
        } else if (file.url) {
            setActiveFileContent("// Loading from GitHub...");
            try {
                const content = await fetchFileContent(file.url);
                if (lastRequestedFile.current === file.path) {
                    setActiveFileContent(content);
                    setFileTree(prev => updateFileInTree(prev, file.path, { content: content }));
                }
            } catch (e) {
                if (lastRequestedFile.current === file.path) {
                    setActiveFileContent("// Error loading file content.");
                }
            }
        } else {
            setActiveFileContent("// Empty file");
            setFileTree(prev => updateFileInTree(prev, file.path, { content: "// Empty file" }));
        }
    };

    const handleContentChange = async (val: string | undefined) => {
        if (val !== undefined) {
            setActiveFileContent(val);
            if (activeFile) {
                // Mark as modified in the tree
                setFileTree(prev => updateFileInTree(prev, activeFile.path, { 
                    content: val,
                    status: 'modified'
                }));
                
                // If local file, save to disk immediately
                if (activeFile.isLocal && activeFile.handle) {
                    try {
                        await saveFileToDisk(activeFile, val);
                    } catch (e) {
                        console.error("Failed to save to disk", e);
                    }
                }
            }
        }
    };

    const handleConfigLoaded = (config: AetherConfig) => {
        setAetherConfig(config);
        
        if (config.github?.token) {
            setGitHubToken(config.github.token);
        }

        if (config.mcp?.mcpServers) {
            loadMcpConfig(config.mcp.mcpServers);
        }

        if (shellRef.current) {
            shellRef.current.execute(`echo "Configuration loaded. Connected to GitHub, DockerHub (${config.docker?.user})."`);
        }
        
        setActiveView('explorer');
        setIsSidebarOpen(true);
    };

    const handleViewClick = (view: typeof activeView) => {
        if (activeView === view) {
            setIsSidebarOpen(!isSidebarOpen);
        } else {
            setActiveView(view);
            setIsSidebarOpen(true);
        }
    };

    const handleInvite = () => {
        try {
            const url = window.location.href;
            navigator.clipboard.writeText(url);
            alert(`Session Invite Link Copied!\n\nID: ${sessionId}\n\nSend this to a friend. When they open it, they will join THIS session and sync your files.`);
        } catch (e) {
            alert(`Session ID: ${sessionId}\n\n(Could not copy URL automatically due to sandbox restrictions)`);
        }
    };

    const handleStageFile = (path: string) => {
        setFileTree(prev => updateFileInTree(prev, path, { status: 'staged' }));
    };

    const handleCommit = (message: string) => {
        const commitFiles = (nodes: FileNode[]): void => {
            nodes.forEach(node => {
                if (node.status === 'staged') {
                     setFileTree(prev => updateFileInTree(prev, node.path, { status: null }));
                }
                if (node.children) commitFiles(node.children);
            });
        };
        
        const clearStagedStatus = (nodes: FileNode[]): FileNode[] => {
            return nodes.map(node => {
                const newNode = { ...node };
                if (newNode.status === 'staged') newNode.status = null; 
                if (newNode.children) newNode.children = clearStagedStatus(newNode.children);
                return newNode;
            });
        };

        setFileTree(prev => clearStagedStatus(prev));
        if (shellRef.current) shellRef.current.execute(`echo "Commited changes: ${message}"`);
    };

    const handlePush = async () => {
         if (shellRef.current) shellRef.current.execute(`echo "Pushing changes to remote..."`);

        try {
            if (activeFile && activeFile.status === 'modified') {
                await new Promise(r => setTimeout(r, 1000));
                if (shellRef.current) shellRef.current.execute(`echo "Success: Pushed to main."`);
            } else {
                 await new Promise(r => setTimeout(r, 1000));
                 if (shellRef.current) shellRef.current.execute(`echo "Everything up-to-date."`);
            }
        } catch (e: any) {
             if (shellRef.current) shellRef.current.execute(`echo "Error: ${e.message}"`);
        }
    };

    // --- Agent Tool Implementations ---

    const toolHandler: ToolHandler = {
        listFiles: async () => {
            const getPaths = (nodes: FileNode[]): string[] => {
                let paths: string[] = [];
                nodes.forEach(n => {
                    paths.push(n.path);
                    if (n.children) paths = [...paths, ...getPaths(n.children)];
                });
                return paths;
            };
            return getPaths(fileTreeRef.current);
        },
        readFile: async (path) => {
            if (activeFileRef.current?.path === path) {
                return activeContentRef.current;
            }
            const findNode = (nodes: FileNode[]): FileNode | undefined => {
                for (const node of nodes) {
                    if (node.path === path) return node;
                    if (node.children) {
                        const found = findNode(node.children);
                        if (found) return found;
                    }
                }
                return undefined;
            };
            const node = findNode(fileTreeRef.current);
            if (node) {
                 if (node.isLocal && node.handle) {
                     return await readFileFromDisk(node);
                 }
                 if (node.content) return node.content;
                 if (node.url) return await fetchFileContent(node.url);
            }
            return "// File content not available or empty.";
        },
        updateFile: async (path, content) => {
            let targetPath = path;
            if (!path.includes('/')) {
                targetPath = `agent_temp/${path}`;
            }

            const aiUser = { ...AI_AGENT_COLLABORATOR, file: targetPath, cursor: { lineNumber: 1, column: 1 } };
            collaborationService.broadcast({ type: 'JOIN', user: aiUser });

            await new Promise(r => setTimeout(r, 800));

            if (activeFileRef.current?.path === targetPath) {
                setActiveFileContent(content);
            }
            
            // 1. Update Local State
            setFileTree(prev => {
                const newTree = upsertPathInTree(prev, targetPath.split('/'), targetPath, content);
                
                // 2. Broadcast Structural Change to Peers immediately
                collaborationService.broadcast({ type: 'SYNC_FILES', fileTree: newTree });
                return newTree;
            });

            setTimeout(async () => {
                 const findNode = (nodes: FileNode[], p: string): FileNode | undefined => {
                    for (const node of nodes) {
                        if (node.path === p) return node;
                        if (node.children) {
                            const found = findNode(node.children, p);
                            if (found) return found;
                        }
                    }
                    return undefined;
                };
                 const updatedNode = findNode(fileTreeRef.current, targetPath);
                 if (updatedNode && updatedNode.isLocal && updatedNode.handle) {
                     await saveFileToDisk(updatedNode, content);
                 }
            }, 100);

            const lines = content.split('\n');
            collaborationService.broadcast({ 
                type: 'UPDATE', 
                user: { ...aiUser, cursor: { lineNumber: lines.length, column: lines[lines.length-1].length } } 
            });

            setTimeout(() => {
                collaborationService.broadcast({ type: 'LEAVE', userId: aiUser.id });
            }, 2000);
        },
        runTerminal: async (cmd) => {
            if (shellRef.current) {
                if (shellRef.current) {
                   await shellRef.current.execute(`echo "$ ${cmd}"`);
                   await shellRef.current.execute(cmd);
                }
            }
            
            const lowerCmd = cmd.trim().toLowerCase();
            if (lowerCmd.includes('python')) return "Server started on port 5000";
            return "Command executed.";
        },
        listMcpServers: async () => {
             return generateMcpToolDescription();
        },
        executeMcpTool: async (server, cmd, args) => {
             return executeMcpTool(server, cmd, args);
        }
    };

    // --- RENDER CONNECTION STATE ---
    if (isGuest && isConnecting) {
        return (
             <div className="h-screen w-screen bg-ide-bg text-white flex flex-col items-center justify-center gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-ide-accent"></div>
                <div className="text-xl font-bold">Joining Session...</div>
                <div className="text-sm text-gray-500">Waiting for host to sync project files</div>
                <div className="text-xs text-gray-700 font-mono mt-2">ID: {sessionId}</div>
                <button 
                    onClick={() => {
                        collaborationService.claimHost();
                        setIsGuest(false);
                        setIsConnecting(false);
                    }}
                    className="mt-4 px-4 py-2 bg-ide-activity border border-gray-600 rounded text-sm hover:bg-gray-700"
                >
                    Stuck? Start as Host
                </button>
            </div>
        );
    }

    if (!currentUser) return <div className="h-screen w-screen bg-ide-bg text-white flex items-center justify-center">Initializing Aether Studio...</div>;

    const isViewActive = (view: typeof activeView) => activeView === view && isSidebarOpen;

    return (
        <div className="h-screen w-screen flex flex-col bg-ide-bg text-ide-text overflow-hidden font-sans">
            {/* Top Navigation Bar */}
            <div className="h-10 bg-ide-activity flex items-center justify-between px-4 border-b border-ide-border select-none z-20">
                <div className="flex items-center gap-4">
                    <span className="font-bold text-ide-accent">Aether Studio</span>
                    <div className="hidden md:flex gap-3 text-sm text-gray-400">
                        <span className="hover:text-white cursor-pointer">File</span>
                        <span className="hover:text-white cursor-pointer">Edit</span>
                        <span className="hover:text-white cursor-pointer">View</span>
                        <span className="hover:text-white cursor-pointer">Go</span>
                        <span className="hover:text-white cursor-pointer">Run</span>
                        <span className="hover:text-white cursor-pointer">Terminal</span>
                        <span className="hover:text-white cursor-pointer">Help</span>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button 
                        onClick={handleInvite}
                        className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1 rounded transition-colors"
                        title="Invite a friend"
                    >
                        <UserPlusIcon className="w-3 h-3" />
                        <span className="font-semibold">Invite</span>
                    </button>
                    <div className="h-4 w-[1px] bg-ide-border mx-1"></div>
                    <button 
                        onClick={() => setShowPreview(!showPreview)}
                        className={`p-1 rounded ${showPreview ? 'text-ide-accent bg-ide-activity' : 'text-gray-400 hover:text-white'}`}
                        title="Toggle Web Preview"
                    >
                        <EyeIcon className="w-4 h-4" />
                    </button>
                    <button 
                        onClick={() => setShowChat(!showChat)}
                        className={`p-1 rounded ${showChat ? 'text-ide-accent bg-ide-activity' : 'text-gray-400 hover:text-white'}`}
                        title="Toggle AI Chat"
                    >
                        <MessageSquareIcon className="w-4 h-4" />
                    </button>
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-bold" style={{ backgroundColor: currentUser.color }} title={currentUser.name}>
                        {currentUser.name.charAt(0)}
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex overflow-hidden">
                {/* Activity Bar */}
                <div className="w-12 bg-ide-activity flex flex-col items-center py-4 border-r border-ide-border z-10 gap-6">
                    <div 
                        className={`cursor-pointer p-2 rounded ${isViewActive('explorer') ? 'text-white border-l-2 border-ide-accent bg-ide-bg/10' : 'text-gray-500 hover:text-gray-300'}`}
                        onClick={() => handleViewClick('explorer')}
                        title="Explorer"
                    >
                        <FileIcon className="w-6 h-6" />
                    </div>
                    <div 
                         className={`cursor-pointer p-2 rounded ${isViewActive('git') ? 'text-white border-l-2 border-ide-accent bg-ide-bg/10' : 'text-gray-500 hover:text-gray-300'}`}
                         onClick={() => handleViewClick('git')}
                         title="Source Control"
                    >
                        <SourceControlIcon className="w-6 h-6" />
                    </div>
                    <div 
                         className={`cursor-pointer p-2 rounded ${isViewActive('k8s') ? 'text-white border-l-2 border-ide-accent bg-ide-bg/10' : 'text-gray-500 hover:text-gray-300'}`}
                         onClick={() => handleViewClick('k8s')}
                         title="Kubernetes"
                    >
                        <KubernetesIcon className="w-6 h-6" />
                    </div>
                    <div 
                         className={`cursor-pointer p-2 rounded ${isViewActive('docker') ? 'text-white border-l-2 border-ide-accent bg-ide-bg/10' : 'text-gray-500 hover:text-gray-300'}`}
                         onClick={() => handleViewClick('docker')}
                         title="Docker"
                    >
                        <DockerIcon className="w-6 h-6" />
                    </div>
                     <div 
                         className={`cursor-pointer p-2 rounded ${isViewActive('mcp') ? 'text-white border-l-2 border-ide-accent bg-ide-bg/10' : 'text-gray-500 hover:text-gray-300'}`}
                         onClick={() => handleViewClick('mcp')}
                         title="MCP Servers (Databases, Tools)"
                    >
                        <ServerIcon className="w-6 h-6" />
                    </div>
                    
                    <div className="flex-1"></div>
                    
                    <div 
                         className={`cursor-pointer p-2 rounded ${isViewActive('settings') ? 'text-white border-l-2 border-ide-accent bg-ide-bg/10' : 'text-gray-500 hover:text-gray-300'}`}
                         onClick={() => handleViewClick('settings')}
                         title="Settings / Config"
                    >
                        <SettingsIcon className="w-6 h-6" />
                    </div>
                </div>

                {/* Sidebar */}
                {isSidebarOpen && (
                    <div className="w-64 flex-shrink-0 flex flex-col">
                        <Sidebar 
                            fileTree={fileTree} 
                            setFileTree={setFileTree}
                            onFileSelect={handleFileSelect}
                            view={activeView}
                            onStage={handleStageFile}
                            onCommit={handleCommit}
                            onPush={handlePush}
                            dockerConfig={aetherConfig?.docker}
                            mcpServers={aetherConfig?.mcp?.mcpServers}
                            onLoadConfig={handleConfigLoaded}
                        />
                    </div>
                )}

                {/* Editor Area */}
                <div className="flex-1 flex flex-col min-w-0 bg-ide-bg">
                    <div className={`flex-1 flex overflow-hidden ${showPreview ? 'border-b border-ide-border' : ''}`}>
                         {/* Code Editor */}
                        <div className={`h-full flex flex-col relative ${showPreview ? 'w-1/2 border-r border-ide-border' : 'w-full'}`}>
                             <CodeEditor 
                                file={activeFile}
                                fileContent={activeFileContent}
                                onChange={handleContentChange}
                                currentUser={currentUser}
                             />
                        </div>

                        {/* Web Preview */}
                        {showPreview && (
                            <div className="w-1/2 h-full">
                                <Preview activeFile={activeFile} content={activeFileContent} />
                            </div>
                        )}
                    </div>

                    {/* Terminal */}
                    <div className="h-48 flex-shrink-0">
                        <XtermTerminal shell={shellService} />
                    </div>
                </div>

                {/* Chat Assistant */}
                <Chat visible={showChat} toolHandler={toolHandler} />
            </div>
        </div>
    );
}

export default App;
