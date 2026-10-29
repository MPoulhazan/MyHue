import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell';
import { Agent } from './pages/Agent';
import { Music } from './pages/Music';
import { Rules } from './pages/Rules';
import { Remote } from './pages/Remote';
import { Dashboard } from './pages/Dashboard';
import { Lights } from './pages/Lights';
import { Climate } from './pages/Climate';
import { Settings } from './pages/Settings';
import { Sensors } from './pages/Sensors';
import { Speakers } from './pages/Speakers';
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
                    <Route path="/music" element={<Music />} />
                    <Route path="/agent" element={legacy(<Agent />)} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/sensors" element={<Sensors />} />
                    <Route path="/speakers" element={<Speakers />} />
                    <Route path="/rules" element={<Rules />} />
                    <Route path="/google-home" element={<Navigate to="/sensors" replace />} />
                    <Route path="/remote" element={<Remote />} />
                    <Route path="/wakeword" element={legacy(<WakewordRecorder />)} />
                </Route>
            </Routes>
        </Router>
    );
}

export default App;
