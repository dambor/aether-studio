
import React, { useEffect, useRef, useState } from 'react';
import { FileNode } from '../types';

interface PreviewProps {
    activeFile: FileNode | null;
    content: string;
}

const Preview: React.FC<PreviewProps> = ({ activeFile, content }) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [key, setKey] = useState(0);

    // Effect to update iframe content when file/content changes
    useEffect(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;

        // If no file, show placeholder
        if (!activeFile) {
            const doc = iframe.contentDocument;
            if (doc) {
                doc.open();
                doc.write('<body style="background:#1e1e1e;color:#555;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;"><div>Select an HTML file to preview</div></body>');
                doc.close();
            }
            return;
        }

        // Determine content to render
        let htmlContent = '';
        const ext = activeFile.name.split('.').pop()?.toLowerCase();

        if (ext === 'html') {
            htmlContent = content;
        } else if (ext === 'js' || ext === 'ts' || ext === 'tsx' || ext === 'jsx') {
            // For JS/React, we wrap it in a very basic runner (limited support)
            // In a real hackathon project, you might want to use a more complex bundler like esbuild-wasm, 
            // but for a lightweight demo, we just script injection or text display.
            htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>body { background-color: #ffffff; color: #000; padding: 20px; font-family: sans-serif; }</style>
                </head>
                <body>
                    <div id="root"></div>
                    <script type="module">
                        try {
                            ${content.replace(/import .* from .*/g, '// Imports disabled in preview')}
                            console.log('Script executed');
                        } catch(e) {
                            document.body.innerHTML += '<div style="color:red">Runtime Error: ' + e.message + '</div>';
                        }
                    </script>
                </body>
                </html>
            `;
        } else if (ext === 'md') {
            // Very basic Markdown render
            htmlContent = `
                <style>body { font-family: sans-serif; padding: 2rem; background: white; color: black; }</style>
                <div style="white-space: pre-wrap">${content}</div>
            `;
        } else {
             htmlContent = `
                <style>body { font-family: monospace; padding: 1rem; background: #eee; color: #333; }</style>
                <h3>Preview not available for .${ext}</h3>
            `;
        }

        // Write to iframe
        const doc = iframe.contentDocument;
        if (doc) {
            doc.open();
            doc.write(htmlContent);
            doc.close();
        }

    }, [activeFile, content, key]);

    return (
        <div className="h-full flex flex-col bg-white border-l border-ide-border">
            <div className="h-9 bg-gray-100 border-b border-gray-200 flex items-center px-4 justify-between">
                <span className="text-xs font-bold text-gray-600 uppercase">Web Preview</span>
                <button 
                    onClick={() => setKey(k => k + 1)}
                    className="text-xs text-blue-600 hover:text-blue-800"
                >
                    Refresh
                </button>
            </div>
            <div className="flex-1 relative">
                <iframe 
                    ref={iframeRef}
                    title="preview"
                    className="w-full h-full border-none bg-white"
                    sandbox="allow-scripts allow-same-origin allow-modals"
                />
            </div>
        </div>
    );
};

export default Preview;
