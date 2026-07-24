import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App.js';
import { GameProvider } from './state/GameContext.js';
import './styles/tokens.css';
import './styles/global.css';
import './styles/responsive.css';

if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GameProvider>
      <App />
    </GameProvider>
  </React.StrictMode>
);
