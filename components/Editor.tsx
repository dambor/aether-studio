
import React, { useEffect, useState, useRef } from 'react';
import Editor, { OnMount } from "@monaco-editor/react";
import { FileNode, Collaborator } from '../types';
import { collaborationService } from '../services/collaborationService';

interface CodeEditorProps {
    file: FileNode | null;
    fileContent: string;
    onChange: (value: string | undefined) => void;
    currentUser: Collaborator;
}

const CodeEditor: React.FC<CodeEditorProps> = ({ file, fileContent, onChange, currentUser }) => {
    const [language, setLanguage] = useState("javascript");
    const [collaborators, setCollaborators] = useState<Map<string, Collaborator>>(new Map());
    const editorRef = useRef<any>(null);
    const monacoRef = useRef<any>(null);
    const decorationsRef = useRef<string[]>([]);
    const isRemoteUpdate = useRef(false);

    useEffect(() => {
        if (!file) return;
        const ext = file.name.split('.').pop()?.toLowerCase();
        switch (ext) {
            case 'ts': case 'tsx': setLanguage('typescript'); break;
            case 'js': case 'jsx': setLanguage('javascript'); break;
            case 'html': setLanguage('html'); break;
            case 'css': setLanguage('css'); break;
            case 'json': setLanguage('json'); break;
            case 'py': setLanguage('python'); break;
            case 'md': setLanguage('markdown'); break;
            default: setLanguage('plaintext');
        }
    }, [file]);

    // Initialize Collaboration
    useEffect(() => {
        collaborationService.registerUser(currentUser);

        // Update active file when switching
        if (file) {
            collaborationService.updateState({ file: file.path });
        }

        const unsubscribe = collaborationService.subscribe((event) => {
            if (event.type === 'JOIN') {
                if (event.user.id !== currentUser.id) {
                    setCollaborators(prev => new Map(prev).set(event.user.id, event.user));
                    
                    // FIX: Handshake - When someone joins, immediately tell them I am here.
                    const myState = collaborationService.getCurrentUser();
                    if (myState) {
                        collaborationService.broadcast({ type: 'UPDATE', user: myState });
                    }
                }
            } else if (event.type === 'UPDATE') {
                if (event.user.id !== currentUser.id) {
                    setCollaborators(prev => new Map(prev).set(event.user.id, event.user));

                    // FIX: Content Sync
                    // If they are in the same file and sent content, update my editor
                    if (event.user.file === file?.path && event.user.content !== undefined) {
                        const currentVal = editorRef.current?.getValue();
                        if (currentVal !== event.user.content) {
                            isRemoteUpdate.current = true;
                            // Update parent state which flows back down to Editor value prop
                            onChange(event.user.content); 
                            
                            // Direct manipulation for smoother cursor experience during rapid typing
                            // (Optional, but helps prevent cursor jumping if parent re-render is slow)
                            if (editorRef.current && monacoRef.current) {
                                const pos = editorRef.current.getPosition();
                                editorRef.current.setValue(event.user.content);
                                editorRef.current.setPosition(pos);
                            }
                            
                            isRemoteUpdate.current = false;
                        }
                    }
                }
            } else if (event.type === 'LEAVE') {
                setCollaborators(prev => {
                    const next = new Map(prev);
                    next.delete(event.userId);
                    return next;
                });
            }
        });

        // Request update from others (Announce presence)
        collaborationService.broadcast({ type: 'UPDATE', user: currentUser });

        return () => unsubscribe();
    }, [file, currentUser.id]); // Re-run when file changes to broadcast new file path

    // Handle Local Changes
    const handleEditorChange = (value: string | undefined) => {
        // Prevent broadcasting if this change came from a remote user
        if (isRemoteUpdate.current) return;
        
        onChange(value);
        
        if (value !== undefined) {
            collaborationService.updateState({ 
                content: value,
                cursor: editorRef.current?.getPosition() 
            });
        }
    };

    // Update Remote Cursors
    useEffect(() => {
        if (!editorRef.current || !monacoRef.current || !file) return;

        const newDecorations: any[] = [];
        
        collaborators.forEach((user) => {
            // Only show cursor if they are in the same file
            if (user.file === file.path && user.cursor) {
                newDecorations.push({
                    range: new monacoRef.current.Range(
                        user.cursor.lineNumber, 
                        user.cursor.column, 
                        user.cursor.lineNumber, 
                        user.cursor.column
                    ),
                    options: {
                        className: `remote-cursor cursor-${user.id}`,
                        hoverMessage: { value: `${user.name} is editing` }
                    }
                });
            }
        });

        // Inject Dynamic CSS for User Colors
        collaborators.forEach((user) => {
            if (user.file === file.path) {
                const styleId = `style-${user.id}`;
                if (!document.getElementById(styleId)) {
                    const style = document.createElement('style');
                    style.id = styleId;
                    style.innerHTML = `
                        .cursor-${user.id} {
                            border-left: 2px solid ${user.color} !important;
                            background-color: ${user.color}20; /* 20% opacity background for visibility */
                        }
                        .cursor-${user.id}::after {
                            content: "${user.name}";
                            position: absolute;
                            top: -20px;
                            left: 0;
                            background-color: ${user.color};
                            color: white;
                            padding: 2px 4px;
                            border-radius: 2px;
                            font-size: 10px;
                            white-space: nowrap;
                            pointer-events: none;
                        }
                    `;
                    document.head.appendChild(style);
                }
            }
        });

        decorationsRef.current = editorRef.current.deltaDecorations(decorationsRef.current, newDecorations);

    }, [collaborators, file]);

    const handleEditorMount: OnMount = (editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;

        // Theme customization
        monaco.editor.defineTheme('custom-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [],
            colors: {
                'editor.background': '#1e1e1e',
                'editor.lineHighlightBackground': '#2a2d2e',
            }
        });
        monaco.editor.setTheme('custom-dark');

        // Broadcast cursor position changes
        editor.onDidChangeCursorPosition((e) => {
            if (!isRemoteUpdate.current) {
                collaborationService.updateState({
                    cursor: { lineNumber: e.position.lineNumber, column: e.position.column }
                });
            }
        });
    };

    // Filter users active on THIS file for the header display
    const activeUsersOnFile = (Array.from(collaborators.values()) as Collaborator[]).filter(u => u.file === file?.path);

    if (!file) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-ide-bg text-gray-500">
                <div className="w-16 h-16 bg-ide-activity rounded-full mb-4 flex items-center justify-center">
                    <svg className="w-8 h-8 opacity-50" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
                </div>
                <p>Select a file to start editing</p>
                <p className="text-xs mt-2 opacity-50">Enter a repo (e.g. facebook/react) in the sidebar</p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col relative">
            {/* Editor Tab / Header */}
            <div className="h-9 bg-ide-bg flex items-center px-4 border-b border-ide-border justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-sm text-yellow-400 uppercase">{file.name.split('.').pop()}</span>
                    <span className="text-sm text-ide-text font-medium italic">{file.name}</span>
                </div>
                
                {/* Active Collaborators Display */}
                <div className="flex items-center">
                    <div className="flex items-center -space-x-2 mr-2">
                        {activeUsersOnFile.map((user) => (
                            <div 
                                key={user.id} 
                                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-ide-bg cursor-help transition-transform hover:scale-110 hover:z-10"
                                style={{ backgroundColor: user.color }}
                                title={`${user.name} is editing this file`}
                            >
                                {user.name.charAt(0)}
                            </div>
                        ))}
                    </div>
                    {activeUsersOnFile.length > 0 && (
                        <span className="text-xs text-gray-500 animate-pulse">
                            {activeUsersOnFile.length} peer{activeUsersOnFile.length > 1 ? 's' : ''} editing
                        </span>
                    )}
                </div>
            </div>

            {/* Monaco Instance */}
            <Editor
                height="100%"
                language={language}
                value={fileContent}
                onChange={handleEditorChange}
                onMount={handleEditorMount}
                theme="custom-dark"
                options={{
                    minimap: { enabled: true },
                    fontSize: 14,
                    wordWrap: 'on',
                    fontFamily: 'JetBrains Mono',
                    padding: { top: 16 }
                }}
            />
        </div>
    );
};

export default CodeEditor;
