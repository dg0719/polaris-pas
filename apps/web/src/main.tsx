import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { RouterProvider } from './lib/router.tsx';
import { SessionProvider } from './session.tsx';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/data.css';
import './styles/controls.css';
import './styles/feedback.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <RouterProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </RouterProvider>
  </StrictMode>,
);
