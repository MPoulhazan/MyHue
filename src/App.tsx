import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell';
import { Agent } from './pages/Agent';
import Music from './pages/Music';
import { GoogleHome } from './pages/GoogleHome';
import { Rules } from './pages/Rules';
import { Heating } from './pages/Heating';
import { Dashboard } from './pages/Dashboard';
import { Lights } from './pages/Lights';
import { Climate } from './pages/Climate';
import { Settings } from './pages/Settings';
import { WakewordRecorder } from './pages/WakewordRecorder';
import './App.css';

/** Ancienne page, gardée dans son conteneur d'origine jusqu'à sa refonte. */
const legacy = (page: React.ReactNode) => <div className="app">{page}</div>;

function App() {
    return (
        <Router>
            <Routes>
                <Route element={<AppShell />}>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/lights" element={<Lights />} />
                    <Route path="/climate" element={<Climate />} />
                    <Route path="/music" element={legacy(<Music />)} />
                    <Route path="/agent" element={legacy(<Agent />)} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/rules" element={legacy(<Rules />)} />
                    <Route path="/google-home" element={legacy(<GoogleHome />)} />
                    <Route path="/heating" element={legacy(<Heating />)} />
                    <Route path="/wakeword" element={legacy(<WakewordRecorder />)} />
                </Route>
            </Routes>
        </Router>
    );
}

export default App;
