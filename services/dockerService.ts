
import { DockerRepo } from '../types';

export const fetchDockerRepos = async (user: string, token: string): Promise<DockerRepo[]> => {
    // Note: Calling DockerHub API directly from browser typically triggers CORS issues.
    // In a real app, this would go through a backend proxy.
    // We implement the fetch but fallback to mock data if it fails (standard for browser-only hackathons)
    
    try {
        const response = await fetch(`https://hub.docker.com/v2/repositories/${user}/?page_size=10`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            return data.results.map((repo: any) => ({
                user: repo.namespace,
                name: repo.name,
                namespace: repo.namespace,
                description: repo.description,
                pull_count: repo.pull_count,
                last_updated: repo.last_updated,
                tags: ['latest', 'v1.0'] // API requires separate call for tags, mocking for simplicity
            }));
        }
        throw new Error("API Connection Failed");
    } catch (error) {
        console.warn("DockerHub CORS/Network error, falling back to simulation.", error);
        
        // Simulation fallback based on the user provided
        return [
            {
                user: user,
                name: "aether-backend",
                namespace: user,
                description: "Core API service for Aether Studio",
                pull_count: 1250,
                last_updated: new Date().toISOString(),
                tags: ["latest", "v2.1.0", "dev"]
            },
            {
                user: user,
                name: "mongo-sidecar",
                namespace: user,
                description: "Helper container for MCP MongoDB connections",
                pull_count: 42,
                last_updated: new Date(Date.now() - 86400000).toISOString(),
                tags: ["v1.0"]
            },
            {
                user: user,
                name: "node-runner",
                namespace: user,
                description: "Execution environment for user scripts",
                pull_count: 8900,
                last_updated: new Date(Date.now() - 172800000).toISOString(),
                tags: ["18-alpine", "20-alpine"]
            }
        ];
    }
};
