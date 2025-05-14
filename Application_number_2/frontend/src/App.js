import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Login from "./components/Login";
import Home from "./components/Home";
import Chatetudiant from "./components/Chatetudiant";
import Chatprof from "./components/Chatprof";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/chatprof" element={<Chatprof />} />
        <Route path="/chatetudiant" element={<Chatetudiant />} />
      </Routes>
    </Router>
  );}
export default App;

