# Chat Backend API Documentation

## Overview
The chat backend provides a complete messaging system with JWT authentication and AI integration using the existing UniAgent service.

## Authentication Endpoints

### POST /auth/register
Register a new user.

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "role": "user",
  "department": "IT"
}
```

**Response:**
```json
{
  "access_token": "jwt-token-here",
  "user": {
    "id": "uuid",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "department": "IT"
  }
}
```

### POST /auth/login
Login with existing user.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "access_token": "jwt-token-here",
  "user": {
    "id": "uuid",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "department": "IT"
  }
}
```

## Chat Endpoints

All chat endpoints require JWT authentication via `Authorization: Bearer <token>` header.

### POST /chat/send
Send a text message to the AI.

**Request Body:**
```json
{
  "content": "Hello, can you help me analyze some data?"
}
```

**Response:**
```json
{
  "userMessage": {
    "id": "uuid",
    "sender": "user",
    "content": "Hello, can you help me analyze some data?",
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "aiResponse": {
    // AI processing result from UniAgent
  }
}
```

### POST /chat/send-file
Send a message with file attachment.

**Request:** Multipart form data
- `file`: The file to upload
- `request`: Optional text request (defaults to "Process and analyze this file")

**Response:**
```json
{
  "userMessage": {
    "id": "uuid",
    "sender": "user",
    "content": "File uploaded: data.csv - Analyze this employee data",
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "aiResponse": {
    // AI processing result from UniAgent
  }
}
```

### GET /chat/messages
Get all messages for the user's current session.

**Response:**
```json
[
  {
    "id": "uuid",
    "sender": "user",
    "content": "Hello, can you help me analyze some data?",
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  {
    "id": "uuid",
    "sender": "agent",
    "content": "{\"result\": \"AI response here\"}",
    "createdAt": "2024-01-01T00:00:01.000Z"
  }
]
```

### GET /chat/session
Get current session information.

**Response:**
```json
{
  "id": "uuid",
  "title": "New Chat Session",
  "startedAt": "2024-01-01T00:00:00.000Z",
  "lastActivityAt": "2024-01-01T00:00:01.000Z"
}
```

### DELETE /chat/session
Clear the current session and all messages.

**Response:**
```json
{
  "message": "Session cleared successfully"
}
```

## Features

- **JWT Authentication**: Secure user authentication with JWT tokens
- **Single Session per User**: Each user has one active chat session
- **Auto Session Creation**: Sessions are created automatically on first message
- **AI Integration**: Text messages use `uni-agent/process`, file uploads use `uni-agent/upload-and-process`
- **Message History**: All messages are stored and retrievable
- **File Support**: Upload files for AI processing
- **Session Management**: Clear sessions to start fresh

## Environment Variables

Add to your `.env` file:
```
JWT_SECRET=your-secret-key-here
GOOGLE_API_KEY=your-google-api-key
DB_HOST=localhost
DB_PORT=5432
DB_USER=admin
DB_PASSWORD=admin
DB_NAME=corpoagent
```

## Testing

Run the test script to verify all endpoints:
```bash
node test-chat-endpoints.js
```

## Usage Example

1. Start the backend: `npm run start:dev`
2. Register a user: `POST /auth/register`
3. Login: `POST /auth/login`
4. Send messages: `POST /chat/send`
5. Upload files: `POST /chat/send-file`
6. Get history: `GET /chat/messages`
