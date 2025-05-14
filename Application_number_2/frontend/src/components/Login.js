import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { jwtDecode } from "jwt-decode"; // Import de la librairie pour décoder le JWT
import './Login.css';

const Login = () => {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const navigate = useNavigate();

    const handleLogin = async (e) => {
        e.preventDefault();
        try {
            // 1. Authentification
            const response = await api.post("/login", { username, password });
            
            // 2. Stockage du token
            const {access_token} = response.data;
            localStorage.setItem("access_token", access_token);
            
            // 3. Décodage du token pour vérifier les rôles
            const decodedToken = jwtDecode(access_token);
            const userRoles = decodedToken.realm_access?.roles || [];
            
            // 4. Redirection en fonction du rôle
            if (userRoles.includes("prof")) {
                navigate("/chatprof");
            } else if (userRoles.includes("etudiant")) {
                navigate("/chatetudiant");
            } else {
                setError("Vous n'avez pas les permissions nécessaires");
                localStorage.removeItem("access_token"); // Nettoyage du token invalide
            }

        } catch (err) {
            // Gestion des erreurs
            if (err.response?.status === 403) {
                setError("Votre compte n'est pas encore activé. Contactez l'administration.");
            } else {
                setError("Identifiants incorrects");
            }
        }
    };

    return (
        <div className="login-container">
            <h2>Connexion</h2>
            <form onSubmit={handleLogin}>
                <div className="form-group">
                    <input
                        type="text"
                        placeholder="Nom d'utilisateur"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                    />
                </div>
                <div className="form-group">
                    <input
                        type="password"
                        placeholder="Mot de passe"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                </div>
                <button type="submit" className="login-button">
                    Se connecter
                </button>
                {error && <p className="error-message">{error}</p>}
            </form>
        </div>
    );
};

export default Login;