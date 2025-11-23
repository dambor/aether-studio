
import { KubeConfig, K8sContext, K8sResource } from '../types';

// We access the global jsyaml object loaded via <script> tag in index.html
declare const jsyaml: any;

let activeConfig: KubeConfig | null = null;
let activeContext: K8sContext | null = null;

export const initializeKubeConfig = (): boolean => {
    try {
        const saved = localStorage.getItem('kube_config_yaml');
        if (saved && typeof jsyaml !== 'undefined') {
            const config = jsyaml.load(saved) as KubeConfig;
            activeConfig = config;
            
            // Set default context
            const currentCtxName = config['current-context'];
            const currentCtx = config.contexts.find(c => c.name === currentCtxName);
            if (currentCtx) {
                setContext(currentCtx.name);
            }
            console.log("Kubeconfig restored from storage.");
            return true;
        }
    } catch (e) {
        console.warn("Failed to restore kubeconfig", e);
    }
    return false;
};

export const isConfigLoaded = (): boolean => {
    return activeConfig !== null;
};

export const getKubeConfigStatus = () => {
    return {
        loaded: !!activeConfig,
        context: activeContext?.name,
        cluster: activeContext?.cluster,
        user: activeContext?.user
    };
};

export const loadKubeConfig = (yamlContent: string): KubeConfig => {
    try {
        if (typeof jsyaml === 'undefined') {
            throw new Error("js-yaml library not loaded");
        }
        
        const config = jsyaml.load(yamlContent) as KubeConfig;
        activeConfig = config;
        
        // Persist
        localStorage.setItem('kube_config_yaml', yamlContent);
        
        // Set default context
        const currentCtxName = config['current-context'];
        const currentCtx = config.contexts.find(c => c.name === currentCtxName);
        if (currentCtx) {
            setContext(currentCtx.name);
        }
        
        return config;
    } catch (e) {
        console.error("Failed to parse Kubeconfig", e);
        throw new Error("Invalid Kubeconfig YAML");
    }
};

export const getContexts = (): K8sContext[] => {
    if (!activeConfig) return [];
    return activeConfig.contexts.map(c => ({
        name: c.name,
        cluster: c.context.cluster,
        user: c.context.user
    }));
};

export const setContext = (contextName: string) => {
    if (!activeConfig) return;
    const ctx = activeConfig.contexts.find(c => c.name === contextName);
    if (ctx) {
        activeContext = {
            name: ctx.name,
            cluster: ctx.context.cluster,
            user: ctx.context.user
        };
    }
};

export const getActiveContext = () => activeContext;

// Helper to find credentials and endpoint for the active context
const getClusterConfig = () => {
    if (!activeConfig || !activeContext) return null;
    
    const cluster = activeConfig.clusters.find(c => c.name === activeContext!.cluster);
    const user = activeConfig.users.find(u => u.name === activeContext!.user);

    if (!cluster) return null;

    return {
        url: cluster.cluster.server,
        token: user?.user?.token,
        clientCert: user?.user?.["client-certificate-data"],
        clientKey: user?.user?.["client-key-data"]
    };
};

// Centralized Fetcher that tries Direct -> Proxy -> Fail
const fetchK8s = async (apiPath: string, config: any) => {
    let lastError;

    // 1. Try Direct Connection (Works if CORS is enabled on cluster + Static Token)
    try {
        const headers: any = { 'Accept': 'application/json' };
        if (config.token) {
            headers['Authorization'] = `Bearer ${config.token}`;
        }

        const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
        
        const response = await fetch(`${config.url}${path}`, { headers });
        
        if (response.ok) return await response.json();
    } catch (e) {
        console.warn("Direct K8s connection failed (likely CORS). Trying proxy...", e);
        lastError = e;
    }

    // 2. Try Localhost Proxy (kubectl proxy)
    // This allows browser to talk to cluster via localhost:8001
    try {
        const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
        const response = await fetch(`http://127.0.0.1:8001${path}`, {
            headers: { 'Accept': 'application/json' }
        });

        if (response.ok) return await response.json();
        
        throw new Error(`Proxy connection failed: ${response.statusText}`);
    } catch (e: any) {
        console.warn("Localhost proxy connection failed.", e);
        if (!lastError) lastError = e;
    }

    // If we get here, both failed
    throw new Error(`
        Connection Failed.
        
        1. Direct Access: Blocked by CORS or Auth.
        2. Proxy Access: Failed to connect to http://127.0.0.1:8001
        
        SOLUTION:
        Run this command in your terminal to enable browser access:
        
        kubectl proxy --port=8001 --accept-hosts='^.*$'
    `);
};

export const fetchNamespaces = async (): Promise<string[]> => {
    const config = getClusterConfig();
    if (!config) throw new Error("No active cluster configuration");

    try {
        const data = await fetchK8s('/api/v1/namespaces', config);
        return data.items.map((ns: any) => ns.metadata.name);
    } catch (error: any) {
        console.error("Fetch Namespaces Error:", error);
        throw error;
    }
};

export const fetchResources = async (resourceType: 'pods' | 'deployments' | 'services', namespace: string = 'default'): Promise<K8sResource[]> => {
    const config = getClusterConfig();
    if (!config) throw new Error("No active cluster configuration");
    
    let path = '';
    if (resourceType === 'deployments') {
        path = `/apis/apps/v1/namespaces/${namespace}/deployments`;
    } else {
        path = `/api/v1/namespaces/${namespace}/${resourceType}`;
    }

    try {
        const data = await fetchK8s(path, config);
        return data.items;
    } catch (error: any) {
        console.error(`K8s Resource Fetch Error: ${error.message}`);
        throw error;
    }
};
