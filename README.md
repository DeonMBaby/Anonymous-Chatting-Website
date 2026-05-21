# Anony

Anonymous real-time chat app built with React, Express, Socket.IO, and MongoDB Atlas.

The frontend and backend are meant to run together from the Express server. In local development, use the app on `http://127.0.0.1:5000/` so room creation, messaging, uploads, and sockets all use the same origin.

## Stack

- React + Vite
- Express
- Socket.IO
- MongoDB Atlas with Mongoose
- Multer for file uploads

## Features

- Create chat rooms
- Join existing rooms
- Send real-time text messages
- Upload and share files
- Persist rooms and messages in MongoDB
- Health endpoint for app and database status

## Project Structure

```text
.
├─ dist/               Production frontend build served by Express
├─ uploads/            Uploaded files
├─ server.cjs          Express + Socket.IO + MongoDB backend
├─ connect.cjs         MongoDB connectivity check script
├─ index.html          Vite entry HTML
├─ main.js             Frontend source entry used by the build pipeline
└─ .env                Local environment variables
```

## Prerequisites

- Node.js installed
- A MongoDB Atlas cluster
- A MongoDB Atlas database user
- Your current machine IP added to Atlas `Network Access`

## Environment Setup

Create a `.env` file in the project root:

```env
MONGODB_URI=mongodb+srv://username:password@cluster0.example.mongodb.net/anonymouschat?retryWrites=true&w=majority
DB_NAME=anonymouschat
PORT=5000
```

Notes:

- `MONGODB_URI` should be your Atlas connection string.
- `DB_NAME` is the database name used by the app.
- `PORT=5000` is the recommended local app port.
- The server also supports `ATLAS_URI` or `ATLAS URI`, but `MONGODB_URI` is preferred.

## Install

```bash
npm install
```

## Run Locally

Start the full app:

```bash
npm start
```

Then open:

```text
http://127.0.0.1:5000/
```

Important:

- Use `5000`, not the Vite preview URL, for full app testing.
- The backend serves the built frontend and all API routes from the same origin.

## Available Scripts

- `npm start` runs the Express server and serves the app
- `npm run dev` starts the Vite dev server
- `npm run build` builds the frontend into `dist`
- `npm run preview` previews the built frontend only
- `node connect.cjs` checks MongoDB connectivity

## Health Check

The backend exposes:

```text
GET /api/health
```

Example successful response:

```json
{
  "ok": true,
  "app": "anony",
  "database": {
    "status": "connected",
    "databaseName": "anonymouschat",
    "source": "MONGODB_URI",
    "lastConnectedAt": "2026-05-21T09:57:42.986Z",
    "retryAt": null,
    "error": null
  }
}
```

## API Overview

### Rooms

- `GET /api/rooms` list room codes
- `POST /api/rooms` create a room

Example request:

```json
{
  "code": "my-room"
}
```

### Messages

- `GET /api/rooms/:code/messages` get room messages
- `POST /api/rooms/:code/messages` create a text or file message

### Uploads

- `POST /api/upload` upload a file
- Uploaded files are served from `/uploads/...`

## MongoDB Troubleshooting

If room creation fails, check these first:

1. Run `node connect.cjs` to verify Atlas connectivity.
2. Confirm your current IP is allowed in Atlas `Network Access`.
3. Confirm the username and password inside `MONGODB_URI`.
4. Make sure the cluster is active and not paused.
5. Open `http://127.0.0.1:5000/api/health` and inspect the `database` object.

If Atlas is unreachable, the server now stays up and reports database status clearly instead of crashing immediately.

## Local Workflow

Recommended local workflow:

1. Update `.env` with a valid Atlas URI.
2. Run `node connect.cjs`.
3. Start the app with `npm start`.
4. Open `http://127.0.0.1:5000/`.
5. Create a room and test messaging.

## Deployment Notes

The repo includes a `render.yaml` setup. For deployment:

- Set `MONGODB_URI` in the hosting provider environment variables
- Set `DB_NAME`
- Use `npm start` as the start command
- Point the health check to `/api/health`
