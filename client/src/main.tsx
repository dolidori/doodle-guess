import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App.js';
import { GameProvider } from './state/GameContext.js';
import './styles/tokens.css';
import './styles/global.css';
import './styles/responsive.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GameProvider>
      <App />
    </GameProvider>
  </React.StrictMode>
);
