# TODO: Anonymous Chat Website with Join Code (Switched to MongoDB)

## Steps to Complete

- [x] Add Firebase SDK to package.json dependencies
- [x] Create Firebase configuration file (src/firebase.js)
- [x] Modify App.jsx to manage room joining and chat state
- [x] Create JoinRoom component (src/components/JoinRoom.jsx)
- [x] Create ChatRoom component (src/components/ChatRoom.jsx)
- [x] Update App.css for chat UI styling
- [x] Install dependencies (npm install)
- [x] Run development server (npm run dev) and test functionality
- [x] Add create room functionality to JoinRoom component
- [ ] Switch from Firebase to MongoDB backend
  - [ ] Add backend dependencies (express, socket.io, cors)
  - [ ] Create server.js for Express server with Socket.io
  - [ ] Define Mongoose models for Room and Message
  - [ ] Create API endpoints for room creation and message handling
  - [ ] Update frontend to use Socket.io client instead of Firebase
  - [ ] Remove Firebase code and dependencies
  - [ ] Test MongoDB integration and real-time chat
