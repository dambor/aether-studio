
import { MCPServerConfig } from '../types';

let activeMcpServers: Record<string, MCPServerConfig> = {};

export const loadMcpConfig = (servers: Record<string, MCPServerConfig>) => {
    activeMcpServers = servers;
    console.log("MCP Servers loaded:", Object.keys(servers));
};

export const getActiveMcpServers = () => activeMcpServers;

// This simulates the "capabilities" of the MCP server being exposed to the Agent
// In a real desktop app, this would use stdio to query the actual server binary.
export const generateMcpToolDescription = (): string => {
    if (Object.keys(activeMcpServers).length === 0) return "";

    const serverList = Object.keys(activeMcpServers).join(", ");
    return `
CONNECTED MCP SERVERS:
The following external tools are connected via Model Context Protocol (MCP): [${serverList}].
You can query these servers to perform actions like database queries or system operations.
    `;
};

// Simulation of MCP execution
export const executeMcpTool = async (serverName: string, command: string, args: any): Promise<string> => {
    const server = activeMcpServers[serverName];
    if (!server) {
        throw new Error(`MCP Server '${serverName}' not found.`);
    }

    // Mock responses for the specific MongoDB example provided by the user
    if (serverName === 'MongoDB') {
        if (command.includes('list_collections')) {
            return JSON.stringify(["users", "projects", "audit_logs", "sessions"]);
        }
        if (command.includes('find')) {
            return JSON.stringify([
                { _id: "65f2...", name: "Project Alpha", status: "active" },
                { _id: "65f3...", name: "Project Beta", status: "pending" }
            ], null, 2);
        }
        return `Executed '${command}' on MongoDB. (Simulated response)`;
    }

    return `Executed command on ${serverName} with args: ${JSON.stringify(args)}`;
};
