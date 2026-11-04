import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import './styles.css';
import './chat.css';
import './session.css';
import {SupportSession} from './SupportSession';

createRoot(document.getElementById('root')!).render(<StrictMode><SupportSession><App /></SupportSession></StrictMode>);
