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
import './App.css';

function App() {
    return (
        <Router>
            <div className="app">
                <Navigation />
                <Routes>
                    <Route path="/" element={<AppLauncher />} />
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
        </Router>
    );
}

export default App;
