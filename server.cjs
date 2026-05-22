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

// Allow the deployed Vercel frontend in production and local Vite URLs in development.
const allowedOrigins = [
  'https://anonymous-chatting-website-bb9y.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function isAllowedOrigin(origin) {
  return !origin || allowedOrigins.includes(origin);
}

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
};

const io = socketIo(server, {
  cors: {
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by Socket.IO CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST'],
  },
});

const PORT = process.env.PORT || 3002;
const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.ATLAS_URI ||
  process.env['ATLAS URI'];
const DB_NAME = process.env.DB_NAME || 'anonymous_chat';
const DATABASE_RETRY_MS = Number(process.env.DATABASE_RETRY_MS || 15000);
const staticDir = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : path.join(__dirname, 'dist');
const mongoConfigSource = process.env.MONGODB_URI
  ? 'MONGODB_URI'
  : process.env.ATLAS_URI
    ? 'ATLAS_URI'
    : process.env['ATLAS URI']
      ? 'ATLAS URI'
      : null;
const databaseState = {
  status: MONGODB_URI ? 'idle' : 'missing_config',
  lastError: MONGODB_URI ? null : 'Missing MongoDB connection string.',
  lastConnectedAt: null,
  retryAt: null,
};

let databaseRetryTimer = null;

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static(staticDir));

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

async function createAndBroadcastMessage(data = {}) {
  const roomCode = normalizeRoomCode(data.roomCode);
  if (!roomCode) {
    throw new Error('Room code is required');
  }

  const roomExists = await ensureRoomExists(roomCode);
  if (!roomExists) {
    throw new Error('Room not found');
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
    throw new Error('Message cannot be empty');
  }

  const savedMessage = await Message.create(messagePayload);
  const plainMessage = savedMessage.toObject();
  io.to(roomCode).emit('newMessage', plainMessage);
  return plainMessage;
}

function redactMongoUri(uri) {
  if (!uri) {
    return null;
  }

  return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, '//***:***@');
}

function formatDatabaseError(error) {
  if (!MONGODB_URI) {
    return 'Missing MongoDB connection string. Set MONGODB_URI in .env or config.env.';
  }

  if (!error) {
    return 'MongoDB is not connected yet.';
  }

  if (error.name === 'MongooseServerSelectionError') {
    return 'MongoDB Atlas is unreachable. Check your Atlas IP access list, cluster status, and connection string.';
  }

  return error.message || 'MongoDB connection failed.';
}

function getDatabaseStatusPayload() {
  return {
    status: databaseState.status,
    databaseName: DB_NAME,
    source: mongoConfigSource,
    lastConnectedAt: databaseState.lastConnectedAt,
    retryAt: databaseState.retryAt,
    error: databaseState.lastError,
  };
}

function scheduleDatabaseReconnect() {
  if (databaseRetryTimer || !MONGODB_URI) {
    return;
  }

  databaseState.retryAt = new Date(Date.now() + DATABASE_RETRY_MS).toISOString();
  databaseRetryTimer = setTimeout(() => {
    databaseRetryTimer = null;
    connectDatabaseWithRetry();
  }, DATABASE_RETRY_MS);
}

async function connectDatabase() {
  if (!MONGODB_URI) {
    throw new Error(
      'Missing MongoDB connection string. Set MONGODB_URI in .env or config.env.'
    );
  }

  databaseState.status = 'connecting';
  databaseState.lastError = null;
  databaseState.retryAt = null;

  await mongoose.connect(MONGODB_URI, {
    dbName: DB_NAME,
    serverSelectionTimeoutMS: 10000,
  });

  databaseState.status = 'connected';
  databaseState.lastError = null;
  databaseState.lastConnectedAt = new Date().toISOString();
  databaseState.retryAt = null;
  console.log(
    `Connected to MongoDB database "${DB_NAME}" using ${mongoConfigSource} (${redactMongoUri(
      MONGODB_URI
    )})`
  );
}

async function connectDatabaseWithRetry() {
  if (!MONGODB_URI) {
    databaseState.status = 'missing_config';
    databaseState.lastError = formatDatabaseError();
    return;
  }

  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    return;
  }

  try {
    await connectDatabase();
  } catch (error) {
    databaseState.status = 'error';
    databaseState.lastError = formatDatabaseError(error);
    console.error('Failed to connect to MongoDB:', error);
    scheduleDatabaseReconnect();
  }
}

function requireDatabase(_req, res, next) {
  if (mongoose.connection.readyState === 1) {
    return next();
  }

  return res.status(503).json({
    error: formatDatabaseError(databaseState.lastError ? new Error(databaseState.lastError) : null),
    database: getDatabaseStatusPayload(),
  });
}

function emitDatabaseUnavailable(socket, eventName) {
  socket.emit(eventName, formatDatabaseError(databaseState.lastError ? new Error(databaseState.lastError) : null));
}

app.use('/uploads', express.static(uploadsDir));

app.get('/api/health', (_req, res) => {
  const isConnected = mongoose.connection.readyState === 1;

  res.status(isConnected ? 200 : 503).json({
    ok: isConnected,
    app: 'anony',
    database: getDatabaseStatusPayload(),
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

app.use('/api/rooms', requireDatabase);

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

app.post('/api/rooms/:code/messages', async (req, res) => {
  try {
    const roomCode = normalizeRoomCode(req.params.code);
    const savedMessage = await createAndBroadcastMessage({
      roomCode,
      text: req.body?.text,
      user: req.body?.user,
      type: req.body?.type,
      file: req.body?.file,
    });

    return res.status(201).json(savedMessage);
  } catch (error) {
    console.error('Failed to create message:', error);
    const status = error.message === 'Room not found' ? 404 : 400;
    return res.status(status).json({ error: error.message || 'Failed to create message' });
  }
});

io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('joinRoom', async (roomCode) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        emitDatabaseUnavailable(socket, 'roomError');
        return;
      }

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
      if (mongoose.connection.readyState !== 1) {
        emitDatabaseUnavailable(socket, 'messageError');
        return;
      }

      await createAndBroadcastMessage(data);
    } catch (error) {
      console.error('Failed to send message:', error);
      socket.emit('messageError', error.message || 'Failed to send message');
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

async function startServer() {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    connectDatabaseWithRetry();
  });
}

startServer();
