
import React, { useRef, useEffect, useState } from 'react';
import { ShellService } from '../services/shellService';

// Declare globals loaded via CDN
declare const Terminal: any;
declare const FitAddon: any;

interface TerminalProps {
    shell: ShellService | null;
}

const XtermTerminal: React.FC<TerminalProps> = ({ shell }) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermInstance = useRef<any>(null);
    const fitAddon = useRef<any>(null);
    const commandBuffer = useRef<string>('');

    useEffect(() => {
        if (!terminalRef.current) return;

        // Safety check: Ensure Xterm.js is loaded from CDN
        if (typeof Terminal === 'undefined' || typeof FitAddon === 'undefined') {
            console.warn("Xterm.js not loaded yet.");
            terminalRef.current.innerHTML = '<div class="p-4 text-xs text-gray-500 font-mono">Terminal loading... (Waiting for CDN)</div>';
            return;
        }

        try {
            // Initialize Xterm
            const term = new Terminal({
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 14,
                cursorBlink: true,
                theme: {
                    background: '#181818',
                    foreground: '#cccccc',
                    cursor: '#ffffff',
                    selection: '#5da5d533',
                    black: '#181818',
                    blue: '#4080e0',
                    cyan: '#40e0d0',
                    green: '#40e040',
                    magenta: '#e040e0',
                    red: '#e04040',
                    white: '#ffffff',
                    yellow: '#e0e040'
                }
            });

            // Robust FitAddon Instantiation
            // Some CDNs export it as FitAddon.FitAddon, others as just FitAddon
            let fit;
            try {
                fit = new FitAddon.FitAddon();
            } catch (e) {
                try {
                    fit = new FitAddon();
                } catch (e2) {
                    console.error("Failed to instantiate FitAddon:", e2);
                }
            }

            if (fit) {
                term.loadAddon(fit);
            }
            
            term.open(terminalRef.current);
            if (fit) {
                try { fit.fit(); } catch(e) { console.warn("Fit error:", e); }
            }
            
            xtermInstance.current = term;
            fitAddon.current = fit;

            // Banner
            term.writeln('\u001b[1;36mAether Studio Terminal [Linux Emulation]\u001b[0m');
            term.writeln('Powered by Xterm.js & Virtual File System');
            
            // Prompt
            if (shell) {
                shell.setWriter((text) => term.write(text));
                term.write(shell.getPrompt());
            }

            // Input Handling
            term.onData((data: string) => {
                const charCode = data.charCodeAt(0);

                // Enter
                if (charCode === 13) {
                    const command = commandBuffer.current;
                    commandBuffer.current = '';
                    
                    if (command === 'clear') {
                        term.clear();
                        if (shell) term.write(shell.getPrompt());
                        return;
                    }

                    if (shell) {
                        shell.execute(command).then(() => {
                            term.write(shell.getPrompt());
                        });
                    }
                } 
                // Backspace
                else if (charCode === 127) {
                    if (commandBuffer.current.length > 0) {
                        commandBuffer.current = commandBuffer.current.slice(0, -1);
                        term.write('\b \b');
                    }
                } 
                // Normal Characters
                else if (charCode >= 32) {
                    commandBuffer.current += data;
                    term.write(data);
                }
            });

            // Resize observer
            const resizeObserver = new ResizeObserver(() => {
                try { 
                    if (fitAddon.current) fitAddon.current.fit(); 
                } catch(e) {}
            });
            resizeObserver.observe(terminalRef.current);

            return () => {
                term.dispose();
                resizeObserver.disconnect();
            };
        } catch (error) {
            console.error("Terminal initialization failed:", error);
            if (terminalRef.current) {
                terminalRef.current.innerHTML = `<div class="p-4 text-xs text-red-500 font-mono">Terminal Error: ${error}</div>`;
            }
        }
    }, []);

    // Sync shell instance if it changes (unlikely)
    useEffect(() => {
        if (shell && xtermInstance.current) {
            shell.setWriter((text) => xtermInstance.current.write(text));
        }
    }, [shell]);

    return (
        <div className="h-full flex flex-col bg-ide-terminal border-t border-ide-border">
            {/* Terminal Header */}
            <div className="flex items-center px-4 py-1 bg-ide-sidebar border-b border-ide-border text-xs gap-4 select-none">
                <span className="uppercase font-bold border-b border-ide-accent text-white px-1 py-1 cursor-pointer">Terminal</span>
                <span className="uppercase text-gray-500 hover:text-gray-300 cursor-pointer">Output</span>
                <span className="uppercase text-gray-500 hover:text-gray-300 cursor-pointer">Debug Console</span>
                <span className="uppercase text-gray-500 hover:text-gray-300 cursor-pointer">Problems</span>
            </div>
            
            {/* Xterm Container */}
            <div className="flex-1 overflow-hidden p-2 pl-4">
                 <div ref={terminalRef} className="h-full w-full" />
            </div>
        </div>
    );
};

export default XtermTerminal;
