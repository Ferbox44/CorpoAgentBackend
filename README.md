# CorpoAgent Backend

Backend API for CorpoAgent, a corporate AI assistant platform built with NestJS. Provides RESTful endpoints for authentication, user management, intelligent chat, file processing, and knowledge base management.

## 🚀 Features

- **🤖 Unified AI Agent System**: Integration with Google Generative AI through LangChain for intelligent data processing
- **🔐 JWT Authentication**: Secure authentication system with Passport.js and JWT
- **💬 Intelligent Chat**: Chat system with session management and conversational context
- **📊 File Processing**: Support for processing CSV, PDF, and text document files
- **📚 Knowledge Base**: Centralized management of processed documents and extracted insights
- **👥 User Management**: Complete CRUD for users with data isolation
- **🗄️ PostgreSQL Database**: Robust persistence with TypeORM

## 🛠️ Tech Stack

- **Framework**: NestJS 11.x
- **Language**: TypeScript
- **Database**: PostgreSQL with TypeORM
- **Authentication**: JWT + Passport.js
- **AI**: LangChain + Google Generative AI
- **File Processing**: Multer + pdf-parse
- **Validation**: class-validator + class-transformer

## 📋 Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- PostgreSQL (v12 or higher)
- Google Cloud account with API Key for Generative AI

## 🚀 Installation

1. Clone the repository:
```bash
git clone https://github.com/Ferbox44/CorpoAgentBackend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the project root:
```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=corpoagent_db

# JWT Configuration
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=24h

# Google Generative AI
GOOGLE_API_KEY=your_google_api_key

# Server Configuration
PORT=3000

# CORS
CORS_ORIGIN=http://localhost:4200
```

4. Set up PostgreSQL database and create the database:
```sql
CREATE DATABASE corpoagent_db;
```

5. Run migrations (if any) or start the server (synchronize: false in production):
```bash
npm run start:dev
```

## 📜 Available Scripts

```bash
# Development
npm run start:dev          # Start server in development mode with hot-reload

# Production
npm run build              # Build TypeScript project
npm run start:prod         # Start server in production mode

# Testing
npm run test               # Run unit tests
npm run test:watch         # Run tests in watch mode
npm run test:cov           # Run tests with coverage
npm run test:e2e           # Run end-to-end tests

# Code Quality
npm run lint               # Run ESLint
npm run format             # Format code with Prettier
```

## 📁 Project Structure

```
backend/
├── src/
│   ├── agents/
│   │   └── uni-agent/          # Unified AI agent
│   ├── entities/                # TypeORM entities
│   │   ├── users.entity.ts
│   │   ├── chat_session.entity.ts
│   │   ├── message.entity.ts
│   │   └── knowledge_base.entity.ts
│   ├── guards/                  # Authentication guards
│   │   └── jwt-auth.guard.ts
│   ├── modules/
│   │   ├── auth/                # Authentication module
│   │   ├── users/               # Users module
│   │   ├── chat/               # Chat module
│   │   └── knowledge-base/      # Knowledge base module
│   ├── app.module.ts            # Main module
│   ├── app.controller.ts        # Main controller
│   ├── app.service.ts           # Main service
│   └── main.ts                  # Entry point
├── dist/                        # Compiled code
├── docker-compose.yaml          # Docker configuration
├── package.json
├── tsconfig.json
└── README.md
```

## 🔌 Main Endpoints

### Authentication
- `POST /auth/register` - Register new users
- `POST /auth/login` - User login
- `GET /auth/profile` - Get authenticated user profile

### Users
- `GET /users` - List users (requires authentication)
- `GET /users/:id` - Get user by ID
- `PUT /users/:id` - Update user
- `DELETE /users/:id` - Delete user

### Chat
- `POST /chat/sessions` - Create new chat session
- `GET /chat/sessions` - List user sessions
- `GET /chat/sessions/:id` - Get specific session
- `POST /chat/messages` - Send message
- `POST /chat/messages/file` - Send message with file
- `GET /chat/sessions/:id/messages` - Get messages from a session

### Knowledge Base
- `GET /knowledge-base` - List knowledge base documents
- `GET /knowledge-base/:id` - Get specific document
- `POST /knowledge-base` - Add document to knowledge base
- `DELETE /knowledge-base/:id` - Delete document

### AI Agent
- `POST /uni-agent/process` - Process task with AI agent
- `POST /uni-agent/analyze` - Analyze data with AI agent
- `POST /uni-agent/generate-report` - Generate report

### Health Check
- `GET /health` - Server status
- `GET /` - Basic test endpoint

## 🔒 Security

- All protected routes require JWT authentication
- Passwords are encrypted with bcrypt
- Input data validation with class-validator
- CORS configured for development and production
- Environment variables for sensitive configuration

## 🐳 Docker

To run with Docker Compose:

```bash
docker-compose up -d
```

This will start:
- PostgreSQL (if configured)
- pgAdmin on port 5050

## 📝 Development Notes

- The project uses TypeORM with `synchronize: false` in production. Migrations must be handled manually.
- Database credentials should be in environment variables, never in code.
- The server listens on `0.0.0.0` to allow external connections.
- CORS is configured for `http://localhost:4200` by default (Angular frontend).

## 🤝 Contributing

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is private and not licensed for public use.

## 👨‍💻 Author

Developed as part of the CorpoAgent project.

---

**Note**: This backend is designed to work together with the CorpoAgent frontend. Make sure you have the frontend properly configured for a complete experience.
