import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:8001",
  withCredentials: true // ✅ Applique automatiquement à toutes les requêtes
});

api.interceptors.request.use(
  (config) => {
    // Get token from localStorage
    const token = localStorage.getItem('access_token');
    
    // If token exists, add it to the headers
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add a response interceptor to handle authentication errors
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response && error.response.status === 401) {
      // Redirect to login page if unauthorized
      localStorage.removeItem('access_token');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);


export default api;
