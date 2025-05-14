from fastapi import FastAPI, HTTPException, Response, Depends, Request, WebSocket, WebSocketDisconnect, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
import requests
import os
import json
import asyncio
from jose import jwt, JWTError
from jwt import PyJWKClient
import logging
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
from typing import List, Optional

app = FastAPI()
load_dotenv()
security = HTTPBearer()

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Configuration CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://192.168.x.x:3001"],  # Frontend React address
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database connection
def get_db_connection():
    conn = psycopg2.connect(
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        host=os.getenv("DB_HOST")
    )
    conn.autocommit = True
    return conn

# Pydantic models
class LoginRequest(BaseModel):
    username: str
    password: str

class MessageCreate(BaseModel):
    receiver_id: str
    message_text: str

class Message(BaseModel):
    message_id: int
    sender_id: str
    message_text: str
    sent_at: datetime
    is_read: bool

class Conversation(BaseModel):
    conversation_id: int
    prof_id: str
    student_id: str
    last_message_at: datetime
    unread_count: Optional[int] = 0
    last_message: Optional[str] = None

# Keycloak configuration
KEYCLOAK_URL = os.getenv("KEYCLOAK_URL")
REALM = os.getenv("KEYCLOAK_REALM")
ADMIN_USER = os.getenv("KEYCLOAK_ADMIN")
ADMIN_PASSWORD = os.getenv("KEYCLOAK_ADMIN_PASSWORD")
KEYCLOAK_CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET")

# WebSocket connections manager
class ConnectionManager:
    def __init__(self):
        self.active_connections = {}  # user_id -> WebSocket

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        logger.debug(f"User {user_id} connected. Total connections: {len(self.active_connections)}")

    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            logger.debug(f"User {user_id} disconnected. Total connections: {len(self.active_connections)}")

    async def send_message(self, user_id: str, message: dict):
        if user_id in self.active_connections:
            await self.active_connections[user_id].send_json(message)
            return True
        return False

manager = ConnectionManager()

# Helper functions
async def get_admin_token():
    data = {
        "grant_type": "password",
        "client_id": "admin-cli",
        "username": ADMIN_USER,
        "password": ADMIN_PASSWORD
    }
    response = requests.post(
        f"{KEYCLOAK_URL}/realms/master/protocol/openid-connect/token",
        data=data
    )
    return response.json()["access_token"]

async def decode_token(token: str):
    try:
        jwks_url = f"{KEYCLOAK_URL}/realms/{REALM}/protocol/openid-connect/certs"
        jwks_client = PyJWKClient(jwks_url)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        
        payload = jwt.decode(
            token,
            key=signing_key.key,
            algorithms=["RS256"],
            options={
                "verify_aud": False,
                "verify_exp": True,
                "verify_signature": True
            }
        )
        return payload
    except Exception as e:
        logger.error(f"Token decode error: {str(e)}")
        raise

async def get_current_user_info(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        payload = await decode_token(token)
        
        user_info = {
            "user_id": payload.get("sub"),
            "username": payload.get("preferred_username"),
            "roles": payload.get("realm_access", {}).get("roles", [])
        }
        
        # Store user in database if not exists
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        cursor.execute(
            "SELECT user_id FROM users WHERE user_id = %s",
            (user_info["user_id"],)
        )
        
        if cursor.fetchone() is None:
            role = "prof" if "prof" in user_info["roles"] else "etudiant"
            cursor.execute(
                "INSERT INTO users (user_id, username, role) VALUES (%s, %s, %s)",
                (user_info["user_id"], user_info["username"], role)
            )
        
        cursor.close()
        conn.close()
        
        return user_info
    except Exception as e:
        logger.error(f"Authentication error: {str(e)}")
        raise HTTPException(status_code=401, detail=f"Not authenticated: {str(e)}")

def get_user_role(user_roles):
    if "prof" in user_roles:
        return "prof"
    elif "etudiant" in user_roles:
        return "etudiant"
    else:
        return None

# Routes
@app.post("/login")
async def login(credentials: LoginRequest, response: Response):
    try:
        # Call to Keycloak
        keycloak_response = requests.post(
            f"{KEYCLOAK_URL}/realms/{REALM}/protocol/openid-connect/token",
            data={
                "grant_type": "password",
                "client_id": "ENT",
                "client_secret": KEYCLOAK_CLIENT_SECRET,
                "username": credentials.username,
                "password": credentials.password
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        keycloak_response.raise_for_status()
        token_data = keycloak_response.json()

        # Set HTTP-Only cookie
        response.set_cookie(
            key="access_token",
            value=token_data["access_token"],
            httponly=True,
            secure=False,  # Only in production (HTTPS)
            samesite="Lax",
            max_age=3600  # Expiration in seconds
        )
        
        # Also decode the token to get user info
        payload = await decode_token(token_data["access_token"])
        user_id = payload.get("sub")
        username = payload.get("preferred_username")
        roles = payload.get("realm_access", {}).get("roles", [])
        
        # Store user in database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        role = "prof" if "prof" in roles else "etudiant"
        
        cursor.execute(
            """
            INSERT INTO users (user_id, username, role) 
            VALUES (%s, %s, %s)
            ON CONFLICT (user_id) DO UPDATE 
            SET username = EXCLUDED.username, role = EXCLUDED.role
            """,
            (user_id, username, role)
        )
        
        cursor.close()
        conn.close()
        
        return token_data

    except requests.exceptions.HTTPError as e:
        error_msg = e.response.json().get("error_description", "")
        
        if "Account disabled" in error_msg:
            raise HTTPException(
                status_code=403,
                detail="Votre compte n'est pas encore activé"
            )
            
        raise HTTPException(
            status_code=400,
            detail="Identifiants incorrects"
        )

@app.get("/users/professors")
async def get_professors(current_user: dict = Depends(get_current_user_info)):
    """Get all professors (for students)"""
    # Verify user is a student
    if "etudiant" not in current_user["roles"]:
        raise HTTPException(status_code=403, detail="Access forbidden")
    
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    cursor.execute("SELECT user_id, username FROM users WHERE role = 'prof'")
    professors = cursor.fetchall()
    
    cursor.close()
    conn.close()
    
    return professors

@app.get("/users/students")
async def get_students(current_user: dict = Depends(get_current_user_info)):
    """Get all students (for professors)"""
    # Verify user is a professor
    if "prof" not in current_user["roles"]:
        raise HTTPException(status_code=403, detail="Access forbidden")
    
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    cursor.execute("SELECT user_id, username FROM users WHERE role = 'etudiant'")
    students = cursor.fetchall()
    
    cursor.close()
    conn.close()
    
    return students

@app.get("/conversations")
async def get_conversations(current_user: dict = Depends(get_current_user_info)):
    """Get all conversations for the current user"""
    user_id = current_user["user_id"]
    user_role = get_user_role(current_user["roles"])
    
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    # Different query based on user role
    if user_role == "prof":
        role_condition = "c.prof_id = %s"
    else:
        role_condition = "c.student_id = %s"
    
    query = f"""
    SELECT 
        c.conversation_id, 
        c.prof_id, 
        c.student_id, 
        c.last_message_at,
        COALESCE(um.unread_count, 0) as unread_count,
        (SELECT message_text FROM messages 
         WHERE conversation_id = c.conversation_id 
         ORDER BY sent_at DESC LIMIT 1) as last_message,
        p.username as prof_username,
        s.username as student_username
    FROM conversations c
    LEFT JOIN (
        SELECT conversation_id, COUNT(*) as unread_count
        FROM messages
        WHERE is_read = FALSE AND sender_id != %s
        GROUP BY conversation_id
    ) um ON c.conversation_id = um.conversation_id
    JOIN users p ON c.prof_id = p.user_id
    JOIN users s ON c.student_id = s.user_id
    WHERE {role_condition}
    ORDER BY c.last_message_at DESC
    """
    
    cursor.execute(query, (user_id, user_id))
    conversations = cursor.fetchall()
    
    cursor.close()
    conn.close()
    
    return conversations

@app.get("/conversations/{conversation_id}/messages")
async def get_messages(
    conversation_id: int,
    current_user: dict = Depends(get_current_user_info)
):
    """Get all messages for a specific conversation"""
    user_id = current_user["user_id"]
    
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    # Verify the user is part of this conversation
    cursor.execute(
        "SELECT * FROM conversations WHERE conversation_id = %s AND (prof_id = %s OR student_id = %s)",
        (conversation_id, user_id, user_id)
    )
    
    if cursor.fetchone() is None:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=403, detail="Access forbidden")
    
    # Get messages
    cursor.execute(
        """
        SELECT m.*, u.username as sender_username
        FROM messages m
        JOIN users u ON m.sender_id = u.user_id
        WHERE m.conversation_id = %s
        ORDER BY m.sent_at ASC
        """,
        (conversation_id,)
    )
    messages = cursor.fetchall()
    
    # Mark messages as read
    cursor.execute(
        """
        UPDATE messages
        SET is_read = TRUE
        WHERE conversation_id = %s AND sender_id != %s AND is_read = FALSE
        """,
        (conversation_id, user_id)
    )
    
    cursor.close()
    conn.close()
    
    return messages

@app.post("/messages")
async def send_message(
    message: MessageCreate,
    current_user: dict = Depends(get_current_user_info)
):
    """Send a new message"""
    sender_id = current_user["user_id"]
    receiver_id = message.receiver_id
    sender_role = get_user_role(current_user["roles"])
    
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    # Get receiver role
    cursor.execute("SELECT role FROM users WHERE user_id = %s", (receiver_id,))
    receiver = cursor.fetchone()
    
    if not receiver:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Receiver not found")
    
    receiver_role = receiver["role"]
    
    # Different roles for proper conversation setup
    if sender_role == "prof" and receiver_role == "etudiant":
        prof_id = sender_id
        student_id = receiver_id
    elif sender_role == "etudiant" and receiver_role == "prof":
        prof_id = receiver_id
        student_id = sender_id
    else:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=400, detail="Invalid message flow")
    
    # Find or create conversation
    cursor.execute(
        """
        SELECT conversation_id FROM conversations 
        WHERE prof_id = %s AND student_id = %s
        """,
        (prof_id, student_id)
    )
    
    conversation = cursor.fetchone()
    
    if conversation:
        conversation_id = conversation["conversation_id"]
    else:
        cursor.execute(
            """
            INSERT INTO conversations (prof_id, student_id)
            VALUES (%s, %s) RETURNING conversation_id
            """,
            (prof_id, student_id)
        )
        conversation_id = cursor.fetchone()["conversation_id"]
    
    # Insert message
    cursor.execute(
        """
        INSERT INTO messages (conversation_id, sender_id, message_text)
        VALUES (%s, %s, %s) RETURNING message_id, sent_at
        """,
        (conversation_id, sender_id, message.message_text)
    )
    
    new_message = cursor.fetchone()
    
    # Update conversation last_message_at
    cursor.execute(
        """
        UPDATE conversations
        SET last_message_at = CURRENT_TIMESTAMP
        WHERE conversation_id = %s
        """,
        (conversation_id,)
    )
    
    # Get sender username
    cursor.execute("SELECT username FROM users WHERE user_id = %s", (sender_id,))
    sender_username = cursor.fetchone()["username"]
    
    conn.commit()
    cursor.close()
    conn.close()
    
    # Prepare message data
    message_data = {
        "message_id": new_message["message_id"],
        "conversation_id": conversation_id,
        "sender_id": sender_id,
        "sender_username": sender_username,
        "message_text": message.message_text,
        "sent_at": new_message["sent_at"].isoformat(),
        "is_read": False
    }
    
    # Send WebSocket notification if receiver is connected
    asyncio.create_task(manager.send_message(receiver_id, {
        "type": "new_message",
        "data": message_data
    }))
    
    return message_data

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    try:
        # Validate token
        payload = await decode_token(token)
        user_id = payload.get("sub")
        
        if not user_id:
            await websocket.close(code=1008, reason="Invalid token")
            return
        
        await manager.connect(websocket, user_id)
        
        try:
            while True:
                # Keep connection alive
                await websocket.receive_text()
        except WebSocketDisconnect:
            manager.disconnect(user_id)
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        await websocket.close(code=1011, reason=f"Internal error: {str(e)}")