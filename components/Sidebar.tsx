
import React, { useState, useEffect } from 'react';
import { FileNode, FileType, K8sResource, DockerRepo, AetherConfig, MCPServerConfig, GitHubRepo } from '../types';
import { FileIcon, FolderIcon, FolderOpenIcon, GithubIcon, SearchIcon, SourceControlIcon, PlusIcon, CheckIcon, KubernetesIcon, SettingsIcon, DockerIcon, ServerIcon } from './Icons';
import { fetchRepoContents, setGitHubToken, fetchUserRepos, getGitHubToken } from '../services/githubService';
import { loadKubeConfig, getContexts, setContext, fetchResources, fetchNamespaces, isConfigLoaded, getKubeConfigStatus } from '../services/kubernetesService';
import { fetchDockerRepos } from '../services/dockerService';
import { openLocalDirectory } from '../services/fileHandleService';

interface SidebarProps {
    fileTree: FileNode[];
    onFileSelect: (file: FileNode) => void;
    setFileTree: React.Dispatch<React.SetStateAction<FileNode[]>>;
    view: 'explorer' | 'git' | 'k8s' | 'docker' | 'mcp' | 'settings';
    onStage: (path: string) => void;
    onCommit: (message: string) => void;
    onPush: () => void;
    dockerConfig?: { user: string; token: string };
    mcpServers?: Record<string, MCPServerConfig>;
    onLoadConfig: (config: AetherConfig) => void;
}

const FileTreeItem: React.FC<{ 
    node: FileNode; 
    onSelect: (file: FileNode) => void; 
    depth: number;
    owner: string;
    repo: string;
    onUpdateNode: (updatedNode: FileNode) => void;
}> = ({ node, onSelect, depth, owner, repo, onUpdateNode }) => {
    const [loading, setLoading] = useState(false);

    const handleClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        
        if (node.type === FileType.FILE) {
            onSelect(node);
        } else {
            // Toggle Directory
            const newNode = { ...node, isOpen: !node.isOpen };
            
            // Lazy load if children are empty and we are opening
            if (!node.isLocal && newNode.isOpen && (!node.children || node.children.length === 0)) {
                setLoading(true);
                try {
                    const children = await fetchRepoContents(owner, repo, node.path);
                    newNode.children = children;
                } catch (err) {
                    console.error("Failed to load directory", err);
                } finally {
                    setLoading(false);
                }
            }
            onUpdateNode(newNode);
        }
    };

    return (
        <div className="select-none">
            <div 
                className={`flex items-center gap-1.5 py-1 px-2 hover:bg-ide-activity cursor-pointer text-sm ${node.isOpen ? 'text-white' : 'text-gray-400'}`}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={handleClick}
            >
                {node.type === FileType.DIRECTORY ? (
                    node.isOpen ? <FolderOpenIcon className="w-4 h-4 text-ide-accent" /> : <FolderIcon className="w-4 h-4 text-ide-accent" />
                ) : (
                    <FileIcon className="w-4 h-4" />
                )}
                <span className="truncate">{node.name}</span>
                {loading && <span className="text-[10px] animate-pulse">...</span>}
            </div>
            {node.isOpen && node.children && (
                <div>
                    {node.children.map((child) => (
                        <FileTreeItem 
                            key={child.path} 
                            node={child} 
                            onSelect={onSelect} 
                            depth={depth + 1}
                            owner={owner}
                            repo={repo}
                            onUpdateNode={(updatedChild) => {
                                const newChildren = node.children!.map(c => c.path === updatedChild.path ? updatedChild : c);
                                onUpdateNode({ ...node, children: newChildren });
                            }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const Sidebar: React.FC<SidebarProps> = ({ 
    fileTree, 
    setFileTree, 
    onFileSelect, 
    view, 
    onStage, 
    onCommit, 
    onPush,
    dockerConfig,
    mcpServers,
    onLoadConfig 
}) => {
    // Explorer State
    const [repoInput, setRepoInput] = useState('');
    const [githubUserRepos, setGithubUserRepos] = useState<GitHubRepo[]>([]);
    
    // K8s State
    const [k8sNamespaces, setK8sNamespaces] = useState<string[]>([]);
    const [k8sResources, setK8sResources] = useState<K8sResource[]>([]);
    const [activeNamespace, setActiveNamespace] = useState('default');
    const [activeResource, setActiveResource] = useState<'pods' | 'deployments' | 'services'>('pods');

    // Docker State
    const [dockerRepos, setDockerRepos] = useState<DockerRepo[]>([]);

    // Git State
    const [commitMsg, setCommitMsg] = useState('');

    // Settings State
    const [configInput, setConfigInput] = useState('');
    
    // Force Update State for Config Loading
    const [, forceUpdate] = useState(0);

    // Load initial data based on view
    useEffect(() => {
        if (view === 'explorer') {
            const token = getGitHubToken();
            if (token) {
                fetchUserRepos().then(setGithubUserRepos).catch(console.error);
            }
        } else if (view === 'k8s') {
            if (isConfigLoaded()) {
                fetchNamespaces().then(setK8sNamespaces).catch(console.error);
                fetchResources(activeResource, activeNamespace).then(setK8sResources).catch(console.error);
            }
        } else if (view === 'docker') {
            if (dockerConfig) {
                fetchDockerRepos(dockerConfig.user, dockerConfig.token).then(setDockerRepos).catch(console.error);
            }
        }
    }, [view, dockerConfig, activeResource]); // Re-run if resource type changes or view changes

    // K8s Refetch on selection change
    useEffect(() => {
        if (view === 'k8s' && isConfigLoaded()) {
            fetchResources(activeResource, activeNamespace).then(setK8sResources).catch(console.error);
        }
    }, [activeNamespace, activeResource, view]);

    const handleRepoLoad = async (e: React.FormEvent) => {
        e.preventDefault();
        const [owner, repo] = repoInput.split('/');
        if (owner && repo) {
            try {
                const roots = await fetchRepoContents(owner, repo);
                setFileTree(roots);
            } catch (error) {
                alert("Failed to load repo. Check token or existence.");
            }
        }
    };

    const handleLocalOpen = async () => {
        try {
            const files = await openLocalDirectory();
            setFileTree(files);
        } catch (e) {
            console.error(e);
        }
    };

    const handleFileTreeUpdate = (updatedNode: FileNode) => {
        setFileTree(prev => prev.map(node => node.path === updatedNode.path ? updatedNode : node));
    };

    // --- RENDERERS ---

    const renderExplorer = () => (
        <div className="flex flex-col h-full">
            <div className="p-2 border-b border-ide-border">
                <form onSubmit={handleRepoLoad} className="flex gap-1 mb-2">
                    <input 
                        className="bg-ide-activity text-white text-xs p-1 rounded w-full border border-ide-border" 
                        placeholder="user/repo"
                        value={repoInput}
                        onChange={e => setRepoInput(e.target.value)}
                    />
                    <button type="submit" className="bg-ide-accent text-white p-1 rounded">
                        <SearchIcon className="w-4 h-4" />
                    </button>
                </form>
                <button 
                    onClick={handleLocalOpen}
                    className="w-full text-xs bg-gray-700 hover:bg-gray-600 text-white py-1.5 px-2 rounded mb-2 flex items-center justify-center gap-2 border border-gray-600"
                    title="Grant Access to File System"
                >
                    <FolderOpenIcon className="w-3 h-3" /> Open Local Folder
                </button>
                {getGitHubToken() && (
                    <div className="max-h-32 overflow-y-auto mb-2 border-t border-ide-border pt-1">
                        <div className="text-[10px] uppercase text-gray-500 font-bold mb-1">Repositories</div>
                        {githubUserRepos.map(r => (
                            <div 
                                key={r.id} 
                                className="text-xs text-gray-400 hover:text-white cursor-pointer truncate py-0.5"
                                onClick={() => setRepoInput(r.full_name)}
                            >
                                <GithubIcon className="inline w-3 h-3 mr-1" /> {r.full_name}
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <div className="flex-1 overflow-y-auto">
                {fileTree.map(node => (
                    <FileTreeItem 
                        key={node.path} 
                        node={node} 
                        onSelect={onFileSelect} 
                        depth={0} 
                        owner={repoInput.split('/')[0] || ''}
                        repo={repoInput.split('/')[1] || ''}
                        onUpdateNode={handleFileTreeUpdate}
                    />
                ))}
            </div>
        </div>
    );

    const renderGit = () => {
        const modifiedFiles: FileNode[] = [];
        const findModified = (nodes: FileNode[]) => {
            nodes.forEach(n => {
                if (n.status) modifiedFiles.push(n);
                if (n.children) findModified(n.children);
            });
        };
        findModified(fileTree);

        return (
            <div className="p-4 flex flex-col h-full">
                <div className="text-xs font-bold uppercase text-gray-400 mb-4">Source Control</div>
                <div className="flex-1 overflow-y-auto mb-4">
                    {modifiedFiles.length === 0 && <div className="text-gray-500 text-sm italic">No changes detected.</div>}
                    {modifiedFiles.map(f => (
                        <div key={f.path} className="flex items-center justify-between text-sm text-gray-300 mb-2 group">
                            <span className="truncate w-32">{f.name}</span>
                            <div className="flex items-center gap-2">
                                <span className={`text-[10px] uppercase ${f.status === 'modified' ? 'text-yellow-500' : 'text-green-500'}`}>{f.status === 'modified' ? 'M' : 'S'}</span>
                                {f.status === 'modified' && (
                                    <button onClick={() => onStage(f.path)} className="text-gray-500 hover:text-white">
                                        <PlusIcon className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="mt-auto">
                    <textarea 
                        className="w-full bg-ide-activity border border-ide-border rounded p-2 text-sm text-white h-20 mb-2 resize-none"
                        placeholder="Commit message"
                        value={commitMsg}
                        onChange={e => setCommitMsg(e.target.value)}
                    />
                    <div className="flex gap-2">
                        <button 
                            className="flex-1 bg-ide-accent hover:bg-blue-600 text-white py-1 rounded text-sm flex items-center justify-center gap-1"
                            onClick={() => { onCommit(commitMsg); setCommitMsg(''); }}
                        >
                            <CheckIcon className="w-4 h-4" /> Commit
                        </button>
                        <button 
                            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-1 rounded text-sm"
                            onClick={onPush}
                        >
                            Push
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const renderK8s = () => (
        <div className="flex flex-col h-full">
            <div className="p-2 border-b border-ide-border bg-ide-activity">
                <div className="flex gap-2 mb-2">
                    <select 
                        className="bg-ide-bg text-white text-xs border border-ide-border rounded p-1 flex-1"
                        value={activeNamespace}
                        onChange={e => setActiveNamespace(e.target.value)}
                    >
                        {k8sNamespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
                        {k8sNamespaces.length === 0 && <option>default</option>}
                    </select>
                    <select 
                        className="bg-ide-bg text-white text-xs border border-ide-border rounded p-1 flex-1"
                        value={activeResource}
                        onChange={e => setActiveResource(e.target.value as any)}
                    >
                        <option value="pods">Pods</option>
                        <option value="deployments">Deployments</option>
                        <option value="services">Services</option>
                    </select>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
                {!isConfigLoaded() && (
                    <div className="text-gray-500 text-xs text-center mt-10 p-4 border border-dashed border-gray-700 rounded">
                        <KubernetesIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        No Kubeconfig Loaded.<br/>
                        <span className="opacity-70 mt-2 block">Upload in Settings or Open Local Folder containing .kube/config</span>
                    </div>
                )}
                {k8sResources.map(r => (
                    <div key={r.metadata.name} className="mb-2 p-2 bg-ide-activity rounded border border-ide-border hover:border-ide-accent cursor-pointer">
                        <div className="text-sm font-bold text-white flex items-center gap-2">
                            <KubernetesIcon className="w-4 h-4 text-blue-400" />
                            {r.metadata.name}
                        </div>
                        <div className="text-[10px] text-gray-400 mt-1">
                            Age: {Math.floor((Date.now() - new Date(r.metadata.creationTimestamp).getTime()) / (1000 * 60 * 60))}h
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                            Namespace: {r.metadata.namespace}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderDocker = () => (
        <div className="flex flex-col h-full">
            <div className="p-2 border-b border-ide-border">
                <div className="text-xs font-bold uppercase text-gray-400 mb-2">Docker Hub Images</div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
                {!dockerConfig && (
                    <div className="text-gray-500 text-xs text-center mt-10">
                        Docker not configured.<br/>Go to Settings.
                    </div>
                )}
                {dockerRepos.map(repo => (
                    <div key={repo.name} className="mb-3 p-2 bg-ide-activity rounded border border-ide-border">
                        <div className="text-sm font-bold text-white flex items-center gap-2 mb-1">
                            <DockerIcon className="w-4 h-4 text-blue-500" />
                            {repo.namespace}/{repo.name}
                        </div>
                        <div className="text-xs text-gray-400 mb-2">{repo.description || "No description"}</div>
                        <div className="flex gap-2 text-[10px] text-gray-500">
                            <span className="bg-gray-700 px-1 rounded text-white">⬇ {repo.pull_count}</span>
                            <span className="bg-gray-700 px-1 rounded text-white">Last: {new Date(repo.last_updated).toLocaleDateString()}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderMcp = () => (
        <div className="flex flex-col h-full">
             <div className="p-2 border-b border-ide-border">
                <div className="text-xs font-bold uppercase text-gray-400 mb-2">MCP Servers</div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
                {!mcpServers || Object.keys(mcpServers).length === 0 ? (
                     <div className="text-gray-500 text-xs text-center mt-10">
                        No MCP Servers Connected.
                    </div>
                ) : (
                    Object.entries(mcpServers).map(([name, config]) => (
                        <div key={name} className="mb-2 p-2 bg-ide-activity rounded border border-ide-border">
                             <div className="text-sm font-bold text-white flex items-center gap-2">
                                <ServerIcon className="w-4 h-4 text-green-500" />
                                {name}
                            </div>
                            <div className="text-xs text-gray-500 mt-1 font-mono">{config.command} {config.args.join(' ')}</div>
                            <div className="flex items-center gap-1 mt-2">
                                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                <span className="text-[10px] text-green-500">Connected</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    const renderSettings = () => {
        const handleLoad = () => {
            try {
                const config = JSON.parse(configInput);
                onLoadConfig(config);
                alert("Configuration loaded successfully!");
            } catch (e) {
                alert("Invalid JSON configuration.");
            }
        };

        const k8sStatus = getKubeConfigStatus();
        const ghToken = getGitHubToken();

        return (
            <div className="p-4 flex flex-col h-full bg-ide-sidebar overflow-y-auto">
                <div className="text-xs font-bold uppercase text-gray-400 mb-4">Settings & Integrations</div>
                
                {/* Status Dashboard */}
                <div className="mb-6 bg-ide-activity p-3 rounded border border-ide-border">
                    <div className="text-[10px] uppercase font-bold text-gray-500 mb-2">Connection Status</div>
                    <div className="flex items-center justify-between text-xs mb-1">
                        <span>GitHub</span>
                        <span className={ghToken ? "text-green-500" : "text-red-500"}>{ghToken ? "Authenticated" : "Not Configured"}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs mb-1">
                        <span>Kubernetes</span>
                        <span className={isConfigLoaded() ? "text-green-500" : "text-yellow-500"}>{isConfigLoaded() ? "Connected" : "No Config"}</span>
                    </div>
                    {isConfigLoaded() && (
                        <div className="text-[10px] text-gray-500 mt-1 pl-2 border-l border-gray-600">
                            Context: {k8sStatus?.context || 'N/A'} <br/>
                            Cluster: {k8sStatus?.cluster || 'N/A'}
                        </div>
                    )}
                </div>

                {/* JSON Config Loader */}
                <div className="mb-6">
                    <div className="text-xs text-gray-400 mb-2">Aether Config (JSON)</div>
                    <textarea 
                        className="w-full bg-ide-activity border border-ide-border rounded p-2 text-xs text-white resize-none font-mono mb-2 h-32"
                        placeholder={`{
  "github": { "token": "..." },
  "docker": { "user": "...", "token": "..." }
}`}
                        value={configInput}
                        onChange={e => setConfigInput(e.target.value)}
                    />
                    <button 
                        onClick={handleLoad}
                        className="w-full bg-ide-accent text-white py-2 rounded text-sm hover:bg-blue-600 border border-transparent"
                    >
                        Load Configuration
                    </button>
                </div>

                {/* Kubeconfig Loader */}
                <div className="border-t border-ide-border pt-4">
                    <div className="flex items-center gap-2 mb-2">
                        <KubernetesIcon className="w-4 h-4 text-blue-400" />
                        <div className="text-xs font-bold text-gray-400">Kubernetes Config</div>
                    </div>
                    
                    <p className="text-[10px] text-gray-500 mb-3">
                        Upload your <code>~/.kube/config</code> or <code>config</code> file here. 
                        It will be saved to your browser's local storage securely.
                    </p>

                    <label className="flex flex-col items-center px-4 py-4 bg-ide-activity text-gray-400 rounded border border-dashed border-ide-border cursor-pointer hover:border-ide-accent hover:text-white transition-colors">
                        <span className="text-xs">Click to Upload Kubeconfig</span>
                        <input 
                            type="file" 
                            className="hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    const reader = new FileReader();
                                    reader.onload = (ev) => {
                                        const content = ev.target?.result as string;
                                        try {
                                            loadKubeConfig(content);
                                            alert("Kubeconfig loaded and saved!");
                                            // Force re-render of status
                                            forceUpdate(n => n + 1);
                                        } catch(err) {
                                            console.error(err);
                                            alert("Failed to parse YAML. Ensure it is a valid kubeconfig.");
                                        }
                                    };
                                    reader.readAsText(file);
                                }
                            }}
                        />
                    </label>
                </div>
            </div>
        );
    };

    return (
        <div className="h-full bg-ide-sidebar border-r border-ide-border text-ide-text flex flex-col w-full">
            <div className="h-9 flex items-center px-4 border-b border-ide-border bg-ide-bg flex-shrink-0">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                    {view === 'explorer' && 'Explorer'}
                    {view === 'git' && 'Source Control'}
                    {view === 'k8s' && 'Kubernetes'}
                    {view === 'docker' && 'Docker Hub'}
                    {view === 'mcp' && 'MCP Servers'}
                    {view === 'settings' && 'Settings'}
                </span>
            </div>
            
            <div className="flex-1 overflow-hidden relative">
                {view === 'explorer' && renderExplorer()}
                {view === 'git' && renderGit()}
                {view === 'k8s' && renderK8s()}
                {view === 'docker' && renderDocker()}
                {view === 'mcp' && renderMcp()}
                {view === 'settings' && renderSettings()}
            </div>
        </div>
    );
};

export default Sidebar;
