import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { jwtDecode } from "jwt-decode";
import "./Chat.css";

const Chatetudiant = () => {
  const [professors, setProfessors] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userInfo, setUserInfo] = useState(null);
  const [wsConnection, setWsConnection] = useState(null);
  
  const messagesEndRef = useRef(null);
  const navigate = useNavigate();

  // Check authentication and get user info
  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      navigate("/login");
      return;
    }

    try {
      const decoded = jwtDecode(token);
      const userRoles = decoded.realm_access?.roles || [];
      
      if (!userRoles.includes("etudiant")) {
        localStorage.removeItem("access_token");
        navigate("/login");
        return;
      }

      setUserInfo({
        id: decoded.sub,
        username: decoded.preferred_username,
        roles: userRoles
      });
    } catch (err) {
      localStorage.removeItem("access_token");
      navigate("/login");
    }
  }, [navigate]);

  // Set up WebSocket connection
  useEffect(() => {
    if (!userInfo) return;

    const token = localStorage.getItem("access_token");
    const ws = new WebSocket(`ws://localhost:8001/ws?token=${token}`);

    ws.onopen = () => {
      console.log("WebSocket connected");
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === "new_message") {
        // Handle incoming message
        const newMsg = data.data;
        
        // If this message belongs to the currently selected conversation
        if (selectedConversation && newMsg.conversation_id === selectedConversation.conversation_id) {
          setMessages(prevMessages => [...prevMessages, newMsg]);
        }
        
        // Update conversation list to show new message
        setConversations(prevConversations => {
          return prevConversations.map(conv => {
            if (conv.conversation_id === newMsg.conversation_id) {
              return {
                ...conv,
                last_message: newMsg.message_text,
                last_message_at: newMsg.sent_at,
                unread_count: selectedConversation?.conversation_id === newMsg.conversation_id 
                  ? 0 // If we're viewing this conversation, mark as read
                  : (conv.unread_count || 0) + 1
              };
            }
            return conv;
          });
        });
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
    };

    setWsConnection(ws);

    // Clean up on unmount
    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [userInfo, selectedConversation]);

  // Load professors and conversations
  useEffect(() => {
    if (!userInfo) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Get list of professors
        const professorsResponse = await api.get("/users/professors");
        setProfessors(professorsResponse.data);
        
        // Get conversations
        const conversationsResponse = await api.get("/conversations");
        setConversations(conversationsResponse.data);
        
        setLoading(false);
      } catch (err) {
        setError("Erreur lors du chargement des données");
        setLoading(false);
        console.error(err);
      }
    };

    fetchData();
  }, [userInfo]);

  // Load messages when a conversation is selected
  useEffect(() => {
    if (!selectedConversation) return;

    const fetchMessages = async () => {
      try {
        const response = await api.get(`/conversations/${selectedConversation.conversation_id}/messages`);
        setMessages(response.data);
        
        // Mark conversation as read in our UI
        setConversations(prevConversations => {
          return prevConversations.map(conv => {
            if (conv.conversation_id === selectedConversation.conversation_id) {
              return { ...conv, unread_count: 0 };
            }
            return conv;
          });
        });
      } catch (err) {
        console.error("Error fetching messages:", err);
      }
    };

    fetchMessages();
  }, [selectedConversation]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleProfessorSelect = (professor) => {
    // Find existing conversation or create a placeholder
    const existingConversation = conversations.find(
      c => c.prof_id === professor.user_id
    );
    
    if (existingConversation) {
      setSelectedConversation(existingConversation);
    } else {
      // Create a placeholder for a new conversation
      setSelectedConversation({
        prof_id: professor.user_id,
        prof_username: professor.username,
        student_id: userInfo.id,
        student_username: userInfo.username,
        // This is just a UI placeholder, the real conversation will be created when sending a message
        conversation_id: null,
        last_message: null,
        unread_count: 0
      });
      setMessages([]);
    }
  };
  
  const handleConversationSelect = (conversation) => {
    setSelectedConversation(conversation);
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    
    if (!newMessage.trim() || !selectedConversation) return;
    
    try {
      // Send message to API
      const response = await api.post("/messages", {
        receiver_id: selectedConversation.prof_id,
        message_text: newMessage
      });
      
      // Add message to the local state
      const sentMessage = response.data;
      
      // If this is a new conversation, update with the real conversation_id
      if (!selectedConversation.conversation_id) {
        setSelectedConversation(prev => ({
          ...prev,
          conversation_id: sentMessage.conversation_id
        }));
        
        // Also add the new conversation to the conversations list
        const newConversation = {
          conversation_id: sentMessage.conversation_id,
          prof_id: selectedConversation.prof_id,
          prof_username: selectedConversation.prof_username,
          student_id: userInfo.id,
          student_username: userInfo.username,
          last_message: newMessage,
          last_message_at: sentMessage.sent_at,
          unread_count: 0
        };
        
        setConversations(prev => [newConversation, ...prev]);
      } else {
        // Update existing conversation in the list
        setConversations(prev => 
          prev.map(conv => {
            if (conv.conversation_id === selectedConversation.conversation_id) {
              return {
                ...conv,
                last_message: newMessage,
                last_message_at: sentMessage.sent_at
              };
            }
            return conv;
          })
        );
      }
      
      // Add message to the chat
      setMessages(prev => [...prev, sentMessage]);
      
      // Clear input
      setNewMessage("");
    } catch (err) {
      console.error("Error sending message:", err);
      setError("Erreur lors de l'envoi du message");
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (loading && !userInfo) {
    return <div className="loading">Chargement...</div>;
  }

  return (
    <div className="chat-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>Conversations</h2>
        </div>
        
        <div className="conversation-list">
          {conversations.map(conv => (
            <div 
              key={conv.conversation_id} 
              className={`conversation-item ${selectedConversation?.conversation_id === conv.conversation_id ? 'selected' : ''}`}
              onClick={() => handleConversationSelect(conv)}
            >
              <div className="conversation-info">
                <div className="conversation-name">{conv.prof_username}</div>
                <div className="conversation-preview">
                  {conv.last_message && conv.last_message.length > 30
                    ? `${conv.last_message.substring(0, 27)}...`
                    : conv.last_message}
                </div>
              </div>
              <div className="conversation-meta">
                <div className="conversation-time">
                  {conv.last_message_at && formatDate(conv.last_message_at)}
                </div>
                {conv.unread_count > 0 && (
                  <div className="unread-badge">{conv.unread_count}</div>
                )}
              </div>
            </div>
          ))}
        </div>
        
        <div className="professors-section">
          <h3>Contacter un professeur</h3>
          <div className="professors-list">
            {professors.map(prof => (
              <div 
                key={prof.user_id} 
                className="professor-item"
                onClick={() => handleProfessorSelect(prof)}
              >
                {prof.username}
              </div>
            ))}
          </div>
        </div>
      </div>
      
      <div className="chat-main">
        {selectedConversation ? (
          <>
            <div className="chat-header">
              <h2>{selectedConversation.prof_username}</h2>
            </div>
            
            <div className="messages-container">
              {messages.length === 0 ? (
                <div className="no-messages">
                  Envoyez un message pour démarrer la conversation
                </div>
              ) : (
                messages.map(msg => (
                  <div 
                    key={msg.message_id} 
                    className={`message ${msg.sender_id === userInfo.id ? 'sent' : 'received'}`}
                  >
                    <div className="message-content">
                      {msg.message_text}
                    </div>
                    <div className="message-time">
                      {formatDate(msg.sent_at)}
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
            
            <form className="message-input" onSubmit={handleSendMessage}>
              <input
                type="text"
                placeholder="Écrivez un message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
              />
              <button type="submit" disabled={!newMessage.trim()}>
                Envoyer
              </button>
            </form>
          </>
        ) : (
          <div className="no-conversation">
            <p>Sélectionnez une conversation ou un professeur pour commencer à discuter</p>
          </div>
        )}
      </div>
      
      {error && <div className="error-notification">{error}</div>}
    </div>
  );
};

export default Chatetudiant;