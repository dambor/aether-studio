import { FileNode, FileType } from '../types';

// Virtual Shell Service to simulate Linux commands on the FileTree

export class ShellService {
    private fileTree: FileNode[];
    private setFileTree: (nodes: FileNode[]) => void;
    private cwd: string = '/';
    private user = 'user';
    private hostname = 'aether';
    
    // Output callback to write to Xterm
    private writeOutput: (text: string) => void = () => {};

    constructor(fileTree: FileNode[], setFileTree: (nodes: FileNode[]) => void) {
        this.fileTree = fileTree;
        this.setFileTree = setFileTree;
    }

    public updateFileTree(nodes: FileNode[]) {
        this.fileTree = nodes;
    }

    public setWriter(writer: (text: string) => void) {
        this.writeOutput = writer;
    }

    public getPrompt(): string {
        return `\r\n\u001b[1;32m${this.user}@${this.hostname}\u001b[0m:\u001b[1;34m${this.cwd}\u001b[0m$ `;
    }

    public async execute(commandLine: string) {
        const parts = commandLine.trim().split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);

        if (!cmd) return;

        switch (cmd) {
            case 'ls':
                this.ls(args);
                break;
            case 'cd':
                this.cd(args);
                break;
            case 'pwd':
                this.writeOutput(`\r\n${this.cwd}`);
                break;
            case 'cat':
                this.cat(args);
                break;
            case 'mkdir':
                this.mkdir(args);
                break;
            case 'touch':
                this.touch(args);
                break;
            case 'rm':
                this.rm(args);
                break;
            case 'echo':
                this.writeOutput(`\r\n${args.join(' ')}`);
                break;
            case 'whoami':
                this.writeOutput(`\r\n${this.user}`);
                break;
            case 'help':
                this.writeOutput(`\r\nAvailable commands: ls, cd, pwd, cat, mkdir, touch, rm, echo, whoami, clear`);
                break;
            case 'clear':
                // Handled by UI mostly, but we define it here
                break;
            default:
                this.writeOutput(`\r\nbash: ${cmd}: command not found`);
        }
    }

    private resolveNode(path: string): FileNode | null {
        // Simple resolution for current iteration
        // Does not handle ../ yet perfectly, assumes absolute or relative to root for demo
        if (path === '/' || path === '.') return { name: 'root', type: FileType.DIRECTORY, children: this.fileTree, path: '/' };
        
        // Remove leading ./
        const cleanPath = path.replace(/^\.\//, '');
        
        // Find in root (Simpler for hackathon than full tree traversal)
        // TODO: Full recursive find based on CWD
        const node = this.fileTree.find(n => n.name === cleanPath);
        return node || null;
    }

    private ls(args: string[]) {
        // Simplified LS that lists root or CWD
        // For this demo, we assume CWD logic
        let targetNodes = this.fileTree;
        
        if (this.cwd !== '/') {
            // Find current dir node
            const dirName = this.cwd.replace('/', '');
            const dir = this.fileTree.find(n => n.name === dirName);
            if (dir && dir.children) {
                targetNodes = dir.children;
            }
        }

        const items = targetNodes.map(n => {
            if (n.type === FileType.DIRECTORY) return `\u001b[1;34m${n.name}/\u001b[0m`;
            return n.name;
        });

        this.writeOutput(`\r\n${items.join('  ')}`);
    }

    private cd(args: string[]) {
        const target = args[0];
        if (!target || target === '/') {
            this.cwd = '/';
            return;
        }
        if (target === '..') {
            this.cwd = '/'; // Simple go-to-root for demo
            return;
        }

        // Check if dir exists
        const dir = this.fileTree.find(n => n.name === target && n.type === FileType.DIRECTORY);
        if (dir) {
            this.cwd = `/${target}`;
        } else {
            this.writeOutput(`\r\nbash: cd: ${target}: No such file or directory`);
        }
    }

    private cat(args: string[]) {
        const target = args[0];
        if (!target) return;

        const findFile = (nodes: FileNode[]): FileNode | undefined => {
            for (const node of nodes) {
                if (node.name === target && node.type === FileType.FILE) return node;
                if (node.children) {
                    const found = findFile(node.children);
                    if (found) return found;
                }
            }
            return undefined;
        };

        const node = findFile(this.fileTree);
        if (node) {
            const content = node.content || "// File content not loaded";
            this.writeOutput(`\r\n${content.replace(/\n/g, '\r\n')}`);
        } else {
            this.writeOutput(`\r\ncat: ${target}: No such file`);
        }
    }

    private mkdir(args: string[]) {
        const target = args[0];
        if (!target) return;
        
        // Logic to update App state would go here
        // For hackathon, we mock the success message or trigger a real update if we wired setFileTree deeper
        this.writeOutput(`\r\n(Created directory ${target} - Simulated)`);
    }

    private touch(args: string[]) {
        const target = args[0];
        if (!target) return;
        this.writeOutput(`\r\n(Created file ${target} - Simulated)`);
    }

    private rm(args: string[]) {
        const target = args[0];
        if (!target) return;
        this.writeOutput(`\r\n(Removed ${target} - Simulated)`);
    }
}