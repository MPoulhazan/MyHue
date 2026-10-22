import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Navigation } from './components/Navigation';
import { AgentWidget } from './components/AgentWidget';
import { AppLauncher } from './pages/AppLauncher';
import { Home } from './pages/Home';
import { Stats } from './pages/Stats';
import { Scenes } from './pages/Scenes';
import { Rooms } from './pages/Rooms';
import { Agent } from './pages/Agent';
import Music from './pages/Music';
import { GoogleHome } from './pages/GoogleHome';
import { Rules } from './pages/Rules';
import { Heating } from './pages/Heating';
import { Privacy } from './pages/Privacy';
import { Dashboard } from './pages/Dashboard';
import './App.css';

function App() {
    return (
        <Router>
            <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="*" element={<Classic />} />
            </Routes>
        </Router>
    );
}

/** Anciennes pages, avec la navigation et le widget agent. */
function Classic() {
    return (
        <div className="app">
                <Navigation />
                <Routes>
                    <Route path="/apps" element={<AppLauncher />} />
                    <Route path="/lights" element={<Home />} />
                    <Route path="/rooms" element={<Rooms />} />
                    <Route path="/scenes" element={<Scenes />} />
                    <Route path="/stats" element={<Stats />} />
                    <Route path="/agent" element={<Agent />} />
                    <Route path="/music" element={<Music />} />
                    <Route path="/google-home" element={<GoogleHome />} />
                    <Route path="/rules" element={<Rules />} />
                    <Route path="/heating" element={<Heating />} />
                    <Route path="/privacy" element={<Privacy />} />
                </Routes>
                <AgentWidget />
        </div>
    );
}

export default App;
