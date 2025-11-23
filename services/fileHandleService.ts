
import { FileNode, FileType } from '../types';

export const openLocalDirectory = async (): Promise<FileNode[]> => {
    // Check for browser support
    if (!('showDirectoryPicker' in window)) {
        throw new Error("File System Access API not supported in this browser. Please use Chrome, Edge, or Opera.");
    }

    try {
        // @ts-ignore - showDirectoryPicker is not standard in all TS configs yet
        const dirHandle = await window.showDirectoryPicker();
        const nodes: FileNode[] = [];

        const processEntry = async (handle: any, path: string): Promise<FileNode> => {
            const isDir = handle.kind === 'directory';
            const node: FileNode = {
                name: handle.name,
                path: path ? `${path}/${handle.name}` : handle.name,
                type: isDir ? FileType.DIRECTORY : FileType.FILE,
                handle: handle, // Store the handle for future read/writes
                isLocal: true,
                isOpen: false
            };

            if (isDir) {
                node.children = [];
                // @ts-ignore
                for await (const entry of handle.values()) {
                    node.children.push(await processEntry(entry, node.path));
                }
                // Sort: Directories first, then files
                node.children.sort((a, b) => {
                    if (a.type === b.type) return a.name.localeCompare(b.name);
                    return a.type === FileType.DIRECTORY ? -1 : 1;
                });
            }
            return node;
        };

        // Iterate root directory
        // @ts-ignore
        for await (const entry of dirHandle.values()) {
            nodes.push(await processEntry(entry, ''));
        }
        
        // Sort root
        nodes.sort((a, b) => {
             if (a.type === b.type) return a.name.localeCompare(b.name);
             return a.type === FileType.DIRECTORY ? -1 : 1;
        });

        return nodes;
    } catch (error) {
        console.error("Error opening local directory:", error);
        throw error;
    }
};

export const readFileFromDisk = async (node: FileNode): Promise<string> => {
    if (!node.handle || node.type !== FileType.FILE) {
        throw new Error("Invalid file handle");
    }
    
    try {
        // @ts-ignore
        const file = await node.handle.getFile();
        return await file.text();
    } catch (error) {
        console.error("Error reading file from disk:", error);
        return "// Error reading local file";
    }
};

export const saveFileToDisk = async (node: FileNode, content: string): Promise<void> => {
    if (!node.handle || node.type !== FileType.FILE) {
        return;
    }

    try {
        // @ts-ignore
        const writable = await node.handle.createWritable();
        await writable.write(content);
        await writable.close();
    } catch (error) {
        console.error("Error writing file to disk:", error);
        throw error;
    }
};
