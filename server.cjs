const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, 'config.env') });

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const PORT = process.env.PORT || 3002;
const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.ATLAS_URI ||
  process.env['ATLAS URI'];
const DB_NAME = process.env.DB_NAME || 'anonymous_chat';

app.use(cors());
app.use(express.json());
app.use(express.static('dist'));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const roomSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
  },
  { timestamps: true }
);

const messageSchema = new mongoose.Schema(
  {
    roomCode: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    text: {
      type: String,
      default: '',
      trim: true,
    },
    user: {
      type: String,
      default: 'Anonymous',
      trim: true,
    },
    type: {
      type: String,
      enum: ['text', 'file'],
      default: 'text',
    },
    file: {
      url: String,
      originalName: String,
      size: Number,
      mimeType: String,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { versionKey: false }
);

const Room = mongoose.model('Room', roomSchema);
const Message = mongoose.model('Message', messageSchema);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({ storage });

function normalizeRoomCode(value) {
  return String(value || '').trim();
}

async function ensureRoomExists(roomCode) {
  return Room.exists({ code: roomCode });
}

async function loadRoomMessages(roomCode) {
  return Message.find({ roomCode }).sort({ timestamp: 1, _id: 1 }).lean();
}

async function connectDatabase() {
  if (!MONGODB_URI) {
    throw new Error(
      'Missing MongoDB connection string. Set MONGODB_URI in .env or config.env.'
    );
  }

  await mongoose.connect(MONGODB_URI, {
    dbName: DB_NAME,
  });
  console.log(`Connected to MongoDB database: ${DB_NAME}`);
}

app.use('/uploads', express.static(uploadsDir));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  return res.json({
    url: `/uploads/${file.filename}`,
    originalName: file.originalname,
    size: file.size,
    mimetype: file.mimetype,
  });
});

app.get('/api/rooms', async (_req, res) => {
  try {
    const rooms = await Room.find().sort({ createdAt: -1 }).lean();
    return res.json(rooms.map((room) => room.code));
  } catch (error) {
    console.error('Failed to fetch rooms:', error);
    return res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

app.post('/api/rooms', async (req, res) => {
  try {
    const code = normalizeRoomCode(req.body?.code);
    if (!code) {
      return res.status(400).json({ error: 'Room code is required' });
    }

    const existingRoom = await Room.findOne({ code }).lean();
    if (existingRoom) {
      return res.status(400).json({ error: 'Room code already exists' });
    }

    await Room.create({ code });
    return res.status(201).json({ message: 'Room created successfully', code });
  } catch (error) {
    console.error('Failed to create room:', error);
    return res.status(500).json({ error: 'Failed to create room' });
  }
});

app.get('/api/rooms/:code/messages', async (req, res) => {
  try {
    const code = normalizeRoomCode(req.params.code);
    const roomExists = await ensureRoomExists(code);

    if (!roomExists) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const roomMessages = await loadRoomMessages(code);
    return res.json(roomMessages);
  } catch (error) {
    console.error('Failed to fetch messages:', error);
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('joinRoom', async (roomCode) => {
    try {
      const normalizedCode = normalizeRoomCode(roomCode);
      if (!normalizedCode) {
        socket.emit('roomError', 'Room code is required');
        return;
      }

      const roomExists = await ensureRoomExists(normalizedCode);
      if (!roomExists) {
        socket.emit('roomError', 'Room not found');
        return;
      }

      socket.join(normalizedCode);
      const roomMessages = await loadRoomMessages(normalizedCode);
      socket.emit('loadMessages', roomMessages);
      console.log(`User joined room: ${normalizedCode}`);
    } catch (error) {
      console.error('Failed to join room:', error);
      socket.emit('roomError', 'Failed to join room');
    }
  });

  socket.on('sendMessage', async (data = {}) => {
    try {
      const roomCode = normalizeRoomCode(data.roomCode);
      if (!roomCode) {
        socket.emit('messageError', 'Room code is required');
        return;
      }

      const roomExists = await ensureRoomExists(roomCode);
      if (!roomExists) {
        socket.emit('messageError', 'Room not found');
        return;
      }

      const messagePayload = {
        roomCode,
        text: typeof data.text === 'string' ? data.text.trim() : '',
        user: data.user || 'Anonymous',
        type: data.type === 'file' ? 'file' : 'text',
        timestamp: new Date(),
      };

      if (messagePayload.type === 'file' && data.file) {
        messagePayload.file = {
          url: data.file.url,
          originalName: data.file.originalName,
          size: data.file.size,
          mimeType: data.file.mimeType,
        };
      }

      if (messagePayload.type === 'text' && !messagePayload.text) {
        socket.emit('messageError', 'Message cannot be empty');
        return;
      }

      const savedMessage = await Message.create(messagePayload);
      io.to(roomCode).emit('newMessage', savedMessage.toObject());
    } catch (error) {
      console.error('Failed to send message:', error);
      socket.emit('messageError', 'Failed to send message');
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

async function startServer() {
  try {
    await connectDatabase();
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
