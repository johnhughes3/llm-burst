// Initialize the UI - externalized to comply with Manifest V3 CSP
import { renderApp, detectMode } from './ui-final.js';
renderApp({ mode: detectMode() });