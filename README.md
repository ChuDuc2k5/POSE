# POSE — AI Sales Automation Platform

## Overview
This project contains a NestJS backend and a Next.js frontend for a CRM-style AI lead qualification workspace. The current implementation includes:

- AI chat conversation UI with CRM layout
- REST chat endpoints
- Socket.IO realtime events
- A mock AI layer for lead qualification and tool-calling flows
- A chat lead information panel
- Mock call entry point ready for future WebRTC/voice integration

## Run locally

1. Install dependencies:
   - Backend: `cd backend && npm install`
   - Frontend: `cd frontend && npm install`
2. Copy the environment examples if needed:
   - `backend/.env.example` → `backend/.env`
   - `frontend/.env.example` → `frontend/.env.local`
3. Start the app:
   - Root: `npm start`

## Backend

Run:

```bash
cd backend
npm run start:dev
```

Key routes:

- `POST /chat/conversations`
- `GET /chat/conversations`
- `GET /chat/conversations/:id`
- `GET /chat/conversations/:id/messages`
- `POST /chat/conversations/:id/messages`
- `POST /chat/conversations/:id/call`

## Frontend

Run:

```bash
cd frontend
npm run dev
```

The main chat workspace is available at `http://localhost:3000`.

## WebSocket events

- `chat:send_message`
- `conversation:message`
- `conversation:typing`
- `conversation:status`
- `ai:processing`
- `ai:tool`
- `ai:response`
- `conversation:error`

## Mock AI behavior

The mock AI layer currently detects intent from messages such as budget, location, rejection, and callback requests, then returns a realistic CRM-style response while updating lead metadata. The structure is intentionally isolated so a real LLM or external AI provider can replace it later.

## Database / Prisma

The project includes a Prisma schema under `backend/prisma/schema.prisma` for future relational persistence of customers, leads, conversations, and messages.

For local development, configure `DATABASE_URL` in the backend environment file before enabling a live PostgreSQL instance.

## Known limitations

- The current conversation data is stored in memory for demo/local development because a production database is not configured in this workspace.
- The mock voice/call flow is a UI entry point and not yet wired to a real telephony provider.
- Real authentication is not yet enforced in the chat module.

## Next steps

- Connect the chat backend to PostgreSQL and run Prisma migrations.
- Add authentication and authorization guards.
- Replace the mock AI with an LLM provider abstraction.
- Integrate the same conversation context into the future WebRTC/Mock Caller flow.
