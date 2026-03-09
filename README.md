## EventPass Suite – Backend

EventPass Suite is a unified event engagement platform by **WhiteWall Digital Solutions**, providing live quizzes, polls, Q&A, photo walls, registration, and check‑in tools for events. This project contains the **Node.js / Express backend** that powers the APIs, WebSocket events, authentication, and integrations used by the EventPass frontend.

## Features

- **RESTful API** for managing events, users, registrations, content, and engagement modules
- **Real-time communication** via Socket.IO for live quizzes, polls, and audience interactions
- **MongoDB persistence** for event and user data
- **Email & WhatsApp notifications** using external providers (e.g. Twilio / WhatsApp APIs, SMTP)
- **File & media handling** using AWS S3 / CloudFront
- **CSV / Excel imports & exports** for bulk operations and reporting

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express (HTTP API)
- **Database**: MongoDB (via Mongoose)
- **Real-time**: Socket.IO
- **Storage & Media**: AWS S3
- **Auth / Security**: JWT, bcrypt

## Server & Ports

- The HTTP server is created in `server.js` and listens on the port specified in the environment configuration.
- The default port in `.env.example` is:
  - `PORT=4000`
- WebSockets are served from the same server and should be accessed using your configured host and `PORT`, for example:
  - `http://<YOUR_BACKEND_HOST>:<PORT>`

Make sure your frontend points its API and WebSocket hosts to this backend using your configured host and `PORT` (e.g. `http://<YOUR_BACKEND_HOST>:<PORT>/api` and `http://<YOUR_BACKEND_HOST>:<PORT>`).

## Environment Variables

Environment variables are required for database, authentication, email, storage, and integration configuration. Use `.env.example` as your template.

1. Copy the example file:

   ```bash
   cp .env.example .env
   ```

2. Open `.env` and fill in the values:

> **Do not** commit `.env` with real credentials to version control. Only `.env.example` should be tracked.

## Setup & Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/Whitewall-Digital-Solutions/eventpass-suite-backend.git

   cd EventPass/eventpass-suite-backend
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment**

   - Copy `.env.example` to `.env` and fill in the values as described above.
   - Ensure MongoDB instances are available and reachable from the configured URIs.

## Running the Project

### Development

Uses `nodemon` for automatic reloads.

```bash
npm start
```

The server will start on the port defined in `.env` (default **4000**), and logs will indicate:

```text
🚀 Server running on port <PORT>, accessible via LAN
```

## API & Frontend Integration

- The backend exposes REST endpoints consumed by the **EventPass Suite Frontend** (Next.js).
- Ensure:
  - Backend: running on `http://<YOUR_BACKEND_HOST>:<PORT>`
  - Frontend: `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WEBSOCKET_HOST` point to this backend

## License

© WhiteWall Digital Solutions. All rights reserved.

