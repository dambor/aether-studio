
import { GoogleGenAI, Chat, FunctionDeclaration, Type, Part } from "@google/genai";
import { ToolHandler } from "../types";

let chatSession: Chat | null = null;
let genAI: GoogleGenAI | null = null;

// Define Tools
const toolDefinitions: FunctionDeclaration[] = [
    {
        name: "list_files",
        description: "List all files and directories in the current project structure.",
        parameters: { type: Type.OBJECT, properties: {} }
    },
    {
        name: "read_file",
        description: "Read the content of a specific file.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                path: { type: Type.STRING, description: "The path of the file to read (e.g., 'src/App.tsx')" }
            },
            required: ["path"]
        }
    },
    {
        name: "update_file",
        description: "Overwrite the content of a specific file. Use this to write code.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                path: { type: Type.STRING, description: "The path of the file to update" },
                content: { type: Type.STRING, description: "The full new content of the file" }
            },
            required: ["path", "content"]
        }
    },
    {
        name: "run_terminal_command",
        description: "Run a shell command in the simulated terminal.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                command: { type: Type.STRING, description: "The command to run (e.g., 'npm install', 'ls', 'python app.py')" }
            },
            required: ["command"]
        }
    },
    {
        name: "list_mcp_servers",
        description: "List connected MCP (Model Context Protocol) servers available for use.",
        parameters: { type: Type.OBJECT, properties: {} }
    },
    {
        name: "use_mcp_tool",
        description: "Execute a specific tool or command on a connected MCP server (e.g., query a database).",
        parameters: {
            type: Type.OBJECT,
            properties: {
                server_name: { type: Type.STRING, description: "The name of the MCP server to use (e.g., 'MongoDB')" },
                command: { type: Type.STRING, description: "The specific command or query to execute on the server" },
                args: { type: Type.OBJECT, description: "Optional arguments for the command as a JSON object" }
            },
            required: ["server_name", "command"]
        }
    }
];

const initializeGenAI = () => {
    if (!genAI) {
        let apiKey = '';
        try {
            // Safety check for browser environments where process might not be defined
            // In local development (Vite/CRA), ensure your .env file has the key and it is being loaded into process.env
            if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
                apiKey = process.env.API_KEY;
            }
        } catch (e) {
            console.warn("Unable to access process.env.API_KEY");
        }

        if (apiKey) {
            genAI = new GoogleGenAI({ apiKey });
        }
    }
    return genAI;
};

export const createChatSession = (systemInstruction?: string) => {
    const ai = initializeGenAI();
    if (!ai) return null;

    try {
        chatSession = ai.chats.create({
            model: 'gemini-2.5-flash',
            config: {
                systemInstruction: systemInstruction || `You are an expert software engineer agent embedded in a cloud IDE named Aether Studio.
You have access to tools to read files, write code, run terminal commands, and interact with external MCP servers.

CRITICAL INSTRUCTION:
After creating or updating a file (especially runnable scripts like .py, .js, .sh), YOU MUST IMMEDIATELY RUN IT using the 'run_terminal_command' tool to verify it works.
- If you create app.py, run 'python app.py'.
- If you create package.json, run 'npm install'.
- If you create a server, run it.

Do not wait for the user to ask you to run it. Just do it.`,
                tools: [{ functionDeclarations: toolDefinitions }],
            },
        });
        return chatSession;
    } catch (error) {
        console.error("Failed to create chat session:", error);
        return null;
    }
};

// We use a recursive function to handle the multi-turn nature of function calling
export const sendMessageToGemini = async function* (message: string, tools: ToolHandler, imageBase64?: string) {
    if (!chatSession) {
        createChatSession();
    }
    
    if (!chatSession) {
        yield "⚠️ **Configuration Error**: Gemini API Key is missing.\n\nPlease ensure `process.env.API_KEY` is set in your environment variables.";
        return;
    }

    try {
        // Construct Message Parts
        let messageParts: Part[] | string = message;

        if (imageBase64) {
             // Remove the data URL prefix if present (e.g., "data:image/png;base64,")
            const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
            
            messageParts = [
                { text: message },
                {
                    inlineData: {
                        mimeType: 'image/png', // Assuming PNG for simplicity in this demo, usually detected from file
                        data: base64Data
                    }
                }
            ];
        }

        // Send initial message
        let response = await chatSession.sendMessage({ message: messageParts });

        // Loop to handle function calls until the model returns just text
        while (response.functionCalls && response.functionCalls.length > 0) {
            const functionResponses = [];

            for (const call of response.functionCalls) {
                // Yield a status update so the user sees the agent is working
                yield `[Agent is executing: ${call.name}...]`;

                let result = "";
                try {
                    switch (call.name) {
                        case 'list_files':
                            const files = await tools.listFiles();
                            result = JSON.stringify(files);
                            break;
                        case 'read_file':
                            result = await tools.readFile(call.args.path as string);
                            break;
                        case 'update_file':
                            await tools.updateFile(call.args.path as string, call.args.content as string);
                            result = "File updated successfully.";
                            break;
                        case 'run_terminal_command':
                            result = await tools.runTerminal(call.args.command as string);
                            break;
                        case 'list_mcp_servers':
                            result = tools.listMcpServers ? await tools.listMcpServers() : "No MCP servers connected.";
                            break;
                        case 'use_mcp_tool':
                            if (tools.executeMcpTool) {
                                result = await tools.executeMcpTool(
                                    call.args.server_name as string, 
                                    call.args.command as string, 
                                    call.args.args
                                );
                            } else {
                                result = "Error: MCP Tool execution not supported by client.";
                            }
                            break;
                        default:
                            result = "Error: Function not found.";
                    }
                } catch (e: any) {
                    result = `Error executing function: ${e.message}`;
                }

                functionResponses.push({
                    id: call.id,
                    name: call.name,
                    response: { result: result }
                });
            }

            // Send the execution results back to the model
            const parts: Part[] = functionResponses.map(resp => ({
                functionResponse: resp
            }));
            
            response = await chatSession.sendMessage({ message: parts });
        }

        // Return final text response
        if (response.text) {
            yield response.text;
        }

    } catch (error: any) {
        console.error("Gemini Error:", error);
        
        // Detect specific API Key errors to give better feedback
        const errorString = error.toString() + (error.message || "");
        if (errorString.includes("API_KEY_INVALID") || errorString.includes("API key not valid")) {
            yield `🚫 **Access Denied**: The Gemini API Key provided is invalid.
            
**How to fix locally:**
1. Check that you have a valid API Key from Google AI Studio.
2. Ensure it is correctly set in your environment (e.g. \`.env\` file) as \`API_KEY\`.
3. Restart your development server.`;
        } else {
            yield `❌ **Error**: ${error.message || "An unexpected error occurred while contacting Gemini."}`;
        }
    }
};
