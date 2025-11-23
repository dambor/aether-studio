
import { FileNode, FileType, GitHubContent, GitHubRepo } from '../types';

const GITHUB_API_BASE = 'https://api.github.com';

// In-memory cache to prevent hitting rate limits
const contentCache = new Map<string, string>();
const treeCache = new Map<string, FileNode[]>();

let githubToken: string | null = null;

export const setGitHubToken = (token: string) => {
    githubToken = token;
    // Clear caches when switching identities
    contentCache.clear();
    treeCache.clear();
};

export const getGitHubToken = () => githubToken;

const getHeaders = () => {
    const headers: HeadersInit = {
        'Accept': 'application/vnd.github.v3+json',
    };
    if (githubToken) {
        headers['Authorization'] = `Bearer ${githubToken}`;
    }
    return headers;
};

// Helper to convert GitHub API response to our FileNode format
const mapGitHubContentToFileNode = (item: GitHubContent): FileNode => ({
    name: item.name,
    path: item.path,
    type: item.type === 'dir' ? FileType.DIRECTORY : FileType.FILE,
    url: item.download_url || undefined,
    children: item.type === 'dir' ? [] : undefined,
    isOpen: false
});

export const fetchUserRepos = async (): Promise<GitHubRepo[]> => {
    if (!githubToken) {
        throw new Error("Authentication required. Please set a GitHub Token.");
    }

    try {
        // Fetch user repos, sorted by recently updated, max 100
        const response = await fetch(`${GITHUB_API_BASE}/user/repos?sort=updated&per_page=100&type=all`, { 
            headers: getHeaders() 
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch repos: ${response.statusText}`);
        }

        const repos: GitHubRepo[] = await response.json();
        return repos;
    } catch (error) {
        console.error("Fetch User Repos Error:", error);
        throw error;
    }
};

export const fetchRepoContents = async (owner: string, repo: string, path: string = ''): Promise<FileNode[]> => {
    const cacheKey = `${owner}/${repo}/${path}`;
    if (treeCache.has(cacheKey)) {
        return treeCache.get(cacheKey)!;
    }

    try {
        const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`;
        const response = await fetch(url, { headers: getHeaders() });
        
        if (!response.ok) {
            if (response.status === 403 || response.status === 429) {
                 throw new Error("GitHub API Rate Limit Exceeded. Please provide a Token.");
            }
            if (response.status === 404) {
                 throw new Error("Repository or path not found. Check if it is private and requires a Token.");
            }
            throw new Error(`GitHub API Error: ${response.statusText}`);
        }

        const data: GitHubContent[] | GitHubContent = await response.json();

        let result: FileNode[] = [];
        // If data is an array, it's a directory listing
        if (Array.isArray(data)) {
            // Sort directories first, then files
            result = data.map(mapGitHubContentToFileNode).sort((a, b) => {
                if (a.type === b.type) return a.name.localeCompare(b.name);
                return a.type === FileType.DIRECTORY ? -1 : 1;
            });
        } else {
            // Single file
            result = [mapGitHubContentToFileNode(data)];
        }

        treeCache.set(cacheKey, result);
        return result;

    } catch (error) {
        console.error('Failed to fetch repo contents:', error);
        throw error;
    }
};

export const fetchFileContent = async (downloadUrl: string): Promise<string> => {
    if (contentCache.has(downloadUrl)) {
        return contentCache.get(downloadUrl)!;
    }

    try {
        const response = await fetch(downloadUrl); // Download URL usually public or SAS, but for private repos we might need API
        
        if (!response.ok) {
            // If direct download fails (private repo), try via API contents
            if (response.status === 403 || response.status === 404) {
                // Fallback logic could go here if we had the API url, but typically download_url works if token was used to get the tree
            }
            throw new Error(`HTTP ${response.status}`);
        }
        
        const text = await response.text();
        contentCache.set(downloadUrl, text);
        return text;
    } catch (error: any) {
        console.error("Fetch File Error:", error);
        return `// ⚠️ Unable to load file content.\n// \n// SYSTEM ERROR: ${error.message}\n// \n// REASON: Network issue or private repo access denied.`;
    }
};

export const pushFileUpdate = async (owner: string, repo: string, path: string, content: string, message: string): Promise<void> => {
    if (!githubToken) {
        throw new Error("Authentication required. Please set a GitHub Token.");
    }

    try {
        // 1. Get current SHA of the file
        const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`;
        const getRes = await fetch(url, { headers: getHeaders() });
        
        let sha: string | undefined;
        if (getRes.ok) {
            const data = await getRes.json();
            sha = data.sha;
        }

        // 2. PUT update
        const body = {
            message: message,
            content: btoa(content), // Base64 encode
            sha: sha
        };

        const putRes = await fetch(url, {
            method: 'PUT',
            headers: {
                ...getHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!putRes.ok) {
            const err = await putRes.json();
            throw new Error(err.message || putRes.statusText);
        }
    } catch (error) {
        console.error("Push Error:", error);
        throw error;
    }
};
