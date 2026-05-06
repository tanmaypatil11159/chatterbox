import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import http from 'http'
import connectDB from './lib/db.js'
import userRouter from './routes/userRoutes.js'
import messageRouter from './routes/messageRoutes.js'
import friendRouter from './routes/friendRoutes.js'
import roomRouter from './routes/roomRoutes.js'
import notificationRouter from './routes/notificationRoutes.js'
import passkeyRouter from './routes/passkeyRoutes.js'
import {Server} from 'socket.io'
import startRoomExpiryScheduler from './lib/roomExpiry.js'

// server creation
const app = express()
const server = http.createServer(app)

// NEW CONCEPT FOR ME: SOCKET.IO SETUP
// Initialize socket.io server with WebSocket support for Vercel
export const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || process.env.VERCEL_URL || "*",
    credentials: true,
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'], // Support both for better compatibility
  allowEIO3: true // Allow Engine.IO v3 clients
});

// Store online users: userId -> Set of socketIds
export const userSocketMap = {};
globalThis.io = io;
globalThis.userSocketMap = userSocketMap;
globalThis.roomPresence = {};

// Socket.io connection handler
io.on("connection", (socket) => {
  const userId = socket.handshake.query.userId;
  console.log("User Connected:", userId);

  // Save user socket
  if (userId) {
    if (!userSocketMap[userId]) {
      userSocketMap[userId] = new Set();
    }
    userSocketMap[userId].add(socket.id);
  }

  // Emit online users
  io.emit("getOnlineUsers", Object.keys(userSocketMap));

  // Join room namespaces for group rooms
  socket.on("room:join", (roomId) => {
    socket.join(`room:${roomId}`);
    const uid = userId?.toString();
    if (!uid) return;
    if (!globalThis.roomPresence[roomId]) globalThis.roomPresence[roomId] = new Set();
    globalThis.roomPresence[roomId].add(uid);
    io.to(`room:${roomId}`).emit("room:presence", {
      roomId: roomId.toString(),
      present: Array.from(globalThis.roomPresence[roomId]),
    });
  });
  socket.on("room:leave", (roomId) => {
    socket.leave(`room:${roomId}`);
    const uid = userId?.toString();
    if (!uid) return;
    const set = globalThis.roomPresence[roomId];
    if (set) {
      set.delete(uid);
      io.to(`room:${roomId}`).emit("room:presence", {
        roomId: roomId.toString(),
        present: Array.from(set),
      });
    }
  });
  socket.on("room:typing", ({ roomId, userId, typing }) => {
    socket.to(`room:${roomId}`).emit("room:typing", { roomId, userId, typing });
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("User Disconnected:", userId);

    if (userId && userSocketMap[userId]) {
      userSocketMap[userId].delete(socket.id);
      if (userSocketMap[userId].size === 0) {
        delete userSocketMap[userId];
      }
    }
    // Remove from all roomPresence sets
    const uid = userId?.toString();
    if (uid) {
      // Check if user still has other active connections
      const isStillOnline = userSocketMap[uid] && userSocketMap[uid].size > 0;
      
      if (!isStillOnline) {
        Object.entries(globalThis.roomPresence).forEach(([rid, set]) => {
          if (set.delete(uid)) {
            io.to(`room:${rid}`).emit("room:presence", { roomId: rid, present: Array.from(set) });
          }
        });
      }
    }

    // Emit updated online users
    io.emit("getOnlineUsers", Object.keys(userSocketMap));
  });

  // WebRTC Signaling
  socket.on("call-user", ({ to, offer, callerInfo }) => {
    const toSocketIds = userSocketMap[to];
    if (toSocketIds) {
      toSocketIds.forEach(socketId => {
        socket.to(socketId).emit("incoming-call", { from: userId, offer, callerInfo });
      });
    }
  });

  socket.on("answer-call", ({ to, answer }) => {
    const toSocketIds = userSocketMap[to];
    if (toSocketIds) {
      toSocketIds.forEach(socketId => {
        socket.to(socketId).emit("call-accepted", { from: userId, answer });
      });
    }
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    const toSocketIds = userSocketMap[to];
    if (toSocketIds) {
      toSocketIds.forEach(socketId => {
        socket.to(socketId).emit("ice-candidate", { from: userId, candidate });
      });
    }
  });

  socket.on("reject-call", ({ to }) => {
    const toSocketIds = userSocketMap[to];
    if (toSocketIds) {
      toSocketIds.forEach(socketId => {
        socket.to(socketId).emit("call-rejected", { from: userId });
      });
    }
  });

  socket.on("end-call", ({ to }) => {
    const toSocketIds = userSocketMap[to];
    if (toSocketIds) {
      toSocketIds.forEach(socketId => {
        socket.to(socketId).emit("call-ended", { from: userId });
      });
    }
  });
});


// middlewares
app.use(express.json({limit: "50mb"}))
app.use(cors({
  origin: process.env.CLIENT_URL || process.env.VERCEL_URL || "*",
  credentials: true
}))

// Lazy DB init — runs once per cold start (safe for Vercel serverless)
let dbReady = false;
let dbInitPromise = null;

const ensureDB = () => {
  if (dbReady) return Promise.resolve();
  if (!dbInitPromise) {
    dbInitPromise = connectDB().then(() => { dbReady = true; });
  }
  return dbInitPromise;
};

// Run DB init middleware BEFORE routes
app.use(async (req, res, next) => {
  try {
    await ensureDB();
    // Check if mongoose is actually connected
    const mongoose = (await import('mongoose')).default;
    if (mongoose.connection.readyState !== 1) {
      throw new Error("Mongoose is not connected (state: " + mongoose.connection.readyState + ")");
    }
    next();
  } catch (err) {
    console.error('DB connection failed in middleware:', err);
    res.status(500).json({ success: false, message: 'Database connection failed', error: err.message });
  }
});

// routes
app.use("/api/status", (req, res)=> res.send("Server is live"))

app.use("/api/auth", userRouter)
app.use("/api/messages", messageRouter)
app.use("/api/friends", friendRouter)
app.use("/api/rooms", roomRouter)
app.use("/api/notifications", notificationRouter)
app.use("/api/passkey", passkeyRouter)

// Global Error Handler to expose the actual serverless crash cause
app.use((err, req, res, next) => {
  console.error("Global Error Handler caught:", err);
  res.status(500).json({
    success: false,
    message: "Internal Server Error",
    error: err.message,
    stack: process.env.NODE_ENV === "production" ? null : err.stack
  });
});

const PORT = process.env.PORT || 6000

// For Vercel serverless - export the app
export default app;

// Only start server if not running in serverless environment
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on PORT: ${PORT}`)
  })
  // start expiry scheduler
  startRoomExpiryScheduler(io)
}
