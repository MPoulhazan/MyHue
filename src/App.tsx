import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Navigation } from './components/Navigation';
import { Home } from './pages/Home';
import { Stats } from './pages/Stats';
import { Scenes } from './pages/Scenes';
import { Rooms } from './pages/Rooms';
import { Agent } from './pages/Agent';
import Music from './pages/Music';
import './App.css';

function App() {
    return (
        <Router>
            <div className="app">
                <Navigation />
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/rooms" element={<Rooms />} />
                    <Route path="/scenes" element={<Scenes />} />
                    <Route path="/stats" element={<Stats />} />
                    <Route path="/agent" element={<Agent />} />
                    <Route path="/music" element={<Music />} />
                </Routes>
            </div>
        </Router>
    );
}

export default App;
