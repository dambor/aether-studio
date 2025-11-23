import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Suppress benign ResizeObserver errors common with Monaco Editor
const ignoredErrors = [
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded'
];

window.addEventListener('error', (e) => {
    if (ignoredErrors.includes(e.message)) {
        e.stopImmediatePropagation();
        return;
    }
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
        <React.StrictMode>
        <App />
        </React.StrictMode>
    );
} catch (e: any) {
    console.error("Root Render Error:", e);
    rootElement.innerHTML = `
        <div style="color:red; padding: 20px; background: #1e1e1e; height: 100vh;">
            <h1>Application Crashed</h1>
            <pre>${e.message || e}</pre>
        </div>
    `;
}