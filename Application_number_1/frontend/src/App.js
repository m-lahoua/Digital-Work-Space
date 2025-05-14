import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Login from "./components/Login";
import Signup from "./components/Signup";
import Dashboard from "./components/Dashboard";
import Home from "./components/Home";
import Signupglobal from "./components/Signupglobal";
import Signupprof from "./components/Signupprof";
import Dashboardprof from "./components/Dashboardprof";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/signupprof" element={<Signupprof />} />
        <Route path="/dashboardprof" element={<Dashboardprof />} />
        <Route path="/signupglobal" element={<Signupglobal />} />
      </Routes>
    </Router>
  );}
export default App;

