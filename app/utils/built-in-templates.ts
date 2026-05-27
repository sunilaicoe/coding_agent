/**
 * Built-in React + Vite template
 * Used as fallback when GitHub template fetch fails
 * This ensures every project starts with a working React + Vite setup
 */

export const REACT_VITE_TEMPLATE = {
  files: {
    'package.json': {
      content: `{
  "name": "genesis-project",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.4.2"
  }
}`,
    },
    'vite.config.js': {
      content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
  },
});
`,
    },
    'index.html': {
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GENESIS Project</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
    },
    'src/main.jsx': {
      content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
    },
    'src/App.jsx': {
      content: `import React from 'react';

function App() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f766e 0%, #14b8a6 50%, #2dd4bf 100%)',
      color: 'white',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{
        textAlign: 'center',
        padding: '3rem',
        background: 'rgba(255,255,255,0.1)',
        borderRadius: '1.5rem',
        backdropFilter: 'blur(10px)',
        maxWidth: '600px',
      }}>
        <h1 style={{ fontSize: '3rem', marginBottom: '1rem', fontWeight: 800 }}>
          GENESIS
          <span style={{ color: '#FF3B30' }}>.</span>
        </h1>
        <p style={{ fontSize: '1.2rem', opacity: 0.9, marginBottom: '2rem' }}>
          Project initialized successfully!
        </p>
        <p style={{ fontSize: '0.9rem', opacity: 0.7 }}>
          The AI is building your application...
        </p>
      </div>
    </div>
  );
}

export default App;
`,
    },
  },
};

/**
 * Generate genesisArtifact XML from the built-in template
 * This is injected as the assistant's first message to bootstrap the project
 */
export function getBuiltInTemplateArtifact(projectTitle: string = 'GENESIS Project') {
  const files = REACT_VITE_TEMPLATE.files;

  const fileActions = Object.entries(files)
    .map(
      ([path, file]) =>
        `<genesisAction type="file" filePath="${path}">
${file.content}
</genesisAction>`,
    )
    .join('\n');

  const assistantMessage = `GENESIS is initializing your React + Vite project with the required files.
<genesisArtifact id="project-setup" title="${projectTitle}" type="bundled">
${fileActions}
</genesisArtifact>`;

  const userMessage = `Project initialized with React + Vite template. All base files are created.

IMPORTANT RULES:
1. Edit ONLY the files that need to be changed for the user's request
2. Do NOT rewrite files that already exist and don't need changes
3. You can create new files as needed
4. After all changes, ALWAYS end with:
   <genesisAction type="shell">npm install</genesisAction>
   <genesisAction type="start">npm run dev</genesisAction>

Now continue with the user's original request to build their application.

IMPORTANT: Do NOT forget to install dependencies and start the dev server at the end.`;

  return { assistantMessage, userMessage };
}
