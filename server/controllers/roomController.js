import crypto from "crypto";
import Room from "../models/Room.js";
import RoomMessage from "../models/RoomMessage.js";
import User from "../models/User.js";
import cloudinary from "../lib/cloudinary.js";
import bcrypt from "bcryptjs";
import Notification from "../models/Notification.js";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { text } from "stream/consumers";



export const createRoom = async (req, res) => {
  try {
    const { roomName, description, maxMembers, expiryTime, allowRequests, joinPassword } = req.body;

    if (!roomName || !expiryTime) {
      return res.status(400).json({ success: false, message: "roomName and expiryTime are required" });
    }

    const minutes = Math.max(1, Math.min(Number(expiryTime), 24 * 60));
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

    const creatorId = req.user._id;  // comes from auth middleware

    let passwordHash;
    if (joinPassword) {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(joinPassword, salt);  // encrypt the password if provided
    }

    const room = await Room.create({  // creation of the room document in db
      roomName,
      description,
      creatorId,
      admins: [creatorId],
      members: [creatorId],
      allowRequests: allowRequests !== false,
      maxMembers: Math.min(Number(maxMembers) || 50, 200),
      expiresAt,
      passwordHash,
      inviteTokens: [],
      joinRequests: []
    });

    res.status(201).json({ success: true, room });

  } catch (e) {
    console.error("createRoom:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const listMyRooms = async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");

    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const me = req.user._id; // from auth middleware
    const now = new Date(); 


    // these three are the three sections which i made in create room page in frontend, created rooms, joined rooms and invitations.
    const createdRooms = await Room.find({  // created by me not expired yet
      creatorId: me,
      isExpired: { $ne: true },
      expiresAt: { $gt: now } 
    })
      .populate({  // populate used here to replace the ids with actual document
        path: "joinRequests",
        select: "fullName profilePic"  // with these fields only
      })
      .sort({ createdAt: -1 })
      .lean(); 
//2
    const joinedRooms = await Room.find({  // me should be one member not created by me and not expired yet
      members: me,
      creatorId: { $ne: me },
      isExpired: { $ne: true },
      expiresAt: { $gt: now } 
    })
      .populate({
        path: "joinRequests",
        select: "fullName profilePic"
      })
      .sort({ createdAt: -1 })  // for the most recent first..
      .lean(); 
//3
    const invitationsRaw = await Room.find({
      isExpired: { $ne: true },
      expiresAt: { $gt: now },
      inviteTokens: {
        $elemMatch: {
          invitedUser: me,
          used: false,
          expiresAt: { $gt: now }
        }
      }
    })
      .select("roomName description creatorId inviteTokens members maxMembers")
      .lean(); 



    const invitations = invitationsRaw.map(room => { 

      const invite = (room.inviteTokens || [])
        .filter(i =>
          String(i.invitedUser) === String(me) &&
          !i.used &&
          i.expiresAt > now
        )
        .sort((a, b) => new Date(b.expiresAt) - new Date(a.expiresAt))[0];

      return {
        _id: room._id,
        roomName: room.roomName,
        description: room.description,
        creatorId: room.creatorId,
        inviteToken: invite?.token,
        members: room.members,
        maxMembers: room.maxMembers,
        isInvitation: true
      };
    });

    res.json({
      success: true,
      createdRooms,
      joinedRooms,
      otherRooms: [],
      invitations
    });

  } catch (e) {
    console.error("listMyRooms error:", e.message, e.stack);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
 
export const getRoom = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id); 
    if(!room || room.isExpired) return res.status(404).json({ success: false, message: "Room not found" });
    const isMember = room.members.some(m => m.equals(req.user._id));
    if (!isMember) return res.status(403).json({ success: false, message: "Not a member" });
    res.json({ success: true, room });
  } catch {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const joinRoomDirect = async (req, res) => {  // without password or request, just join if it's public and not full
  try {
    const room = await Room.findById(req.params.id);
    // check for room existence and if expired
    if (!room || room.isExpired) return res.status(404).json({ success: false, message: "Room not available" });

    // check if room is private and does not allow requests
    if (!room.allowRequests) return res.status(400).json({ success: false, message: "Private room" });

    if (room.passwordHash) {  // if password protected then compare the password with the hash stored in db
      const ok = await bcrypt.compare(req.body.password || "", room.passwordHash);
      if (!ok) return res.status(401).json({ success: false, message: "Invalid room password" });
    }

    if (room.maxMembers && room.members.length >= room.maxMembers) { // checking the limit of the members in the room
      return res.status(400).json({ success: false, message: "Room is full" });
    }

    const uid = req.user._id;  // via auth middleware
    let joinedNow = false;

    // to avoid the multiple entries in same room if user clicks join multiple times
    const memberIds = room.members.map(m => m.toString());

    if (!memberIds.includes(uid.toString())) {   // now you are also the member of the room so pushing your id in members
      room.members.push(uid);
      await room.save();

      joinedNow = true;  // checking flag

      const joinMsg = await RoomMessage.create({
        roomId: room._id,
        senderId: uid,
        text: `${req.user.fullName} joined`,
        system: true
      });


      // basically connection of socket and sending the message to all the members in the room that a new member has joined
      if (globalThis.io)  // check wheather the server exist or not
        globalThis.io.to(`room:${room._id}`).emit("room:message", joinMsg); // sending the message to all the members in the room that a new member has joined
    }

    if (globalThis.io && joinedNow) {
      globalThis.io.to(`room:${room._id}`).emit("room:member_joined", {
        roomId: room._id.toString(),
        userId: uid.toString()
      });
    }

    res.json({ success: true, room });

  } catch (e) {
    console.error("joinRoomDirect:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};



export const requestToJoin = async (req, res) => {
  try {

    const room = await Room.findById(req.params.id);

    if (!room || room.isExpired)
      return res.status(404).json({ success: false, message: "Room not available" });

    if (room.allowRequests)
      return res.status(400).json({ success: false, message: "Room is public. Join directly." });

    const uid = req.user._id.toString();

    const joinRequests = room.joinRequests || [];

    if (!joinRequests.map(String).includes(uid) && !room.members.map(String).includes(uid)) {

      room.joinRequests.push(uid);

      await room.save();

      if (globalThis.io && globalThis.userSocketMap) {
        room.admins.forEach((adminId) => {

          const socketIds = globalThis.userSocketMap[adminId.toString()];

          if (socketIds) {
            socketIds.forEach(socketId => {
              globalThis.io.to(socketId).emit("room:join_request", {
                roomId: room._id,
                userId: uid,
                user: {
                  _id: req.user._id,
                  fullName: req.user.fullName,
                  profilePic: req.user.profilePic
                }
              });
            });
          }

        });

      }

    }

    res.json({ success: true, message: "Request sent" });

  } catch (e) {

    console.error("requestToJoin:", e);

    res.status(500).json({ success: false, message: "Server error" });

  }
}; // not in use yet



export const handleJoinRequest = async (req, res) => {

  try {

    const { action } = req.body;

    const room = await Room.findById(req.params.id); // room id from url params because the admin will be handling the request from the room page only so room id will be in url

    if (!room || room.isExpired)  // room existance
     return res.status(404).json({ success: false, message: "Room not available" });

    const isAdmin = room.admins.map(String).includes(req.user._id.toString()); // currenct user is admin or not

    if (!isAdmin) return res.status(403).json({ success: false, message: "Only admins can manage requests" });

    const targetId = req.params.userId; // user id of the person who requested to join, this will be in url params because the admin will be handling the request from the room page only so user id will be in url

    room.joinRequests = (room.joinRequests || []).filter((u) => u.toString() !== targetId);

    if (action === "accept") {

      if (!room.maxMembers || room.members.length < room.maxMembers) {

        if (!room.members.map(String).includes(targetId.toString()))
          room.members.push(targetId);

        const joinMsg = await RoomMessage.create({
          roomId: room._id,
          senderId: req.user._id,
          text: "Member joined",
          system: true
        });

        if (globalThis.io) {

          globalThis.io.to(`room:${room._id}`).emit("room:message", joinMsg);

          globalThis.io.to(`room:${room._id}`).emit("room:member_joined", {
            roomId: room._id.toString(),
            userId: targetId.toString()
          });

        }

      } else {

        return res.status(400).json({ success: false, message: "Room is full" });

      }

    }

    await room.save();

    if (globalThis.io && globalThis.userSocketMap) {

      const socketIds = globalThis.userSocketMap[targetId.toString()];

      if (socketIds) {
        socketIds.forEach(socketId => {
          globalThis.io.to(socketId).emit("room:request_handled", { roomId: room._id, action });
        });
      }

    }

    res.json({ success: true, room });

  } catch (e) {

    console.error("handleJoinRequest:", e);

    res.status(500).json({ success: false, message: "Server error" });

  }
}; // not in use yet




export const inviteFriend = async (req, res) => {

  try {
    const room = await Room.findById(req.params.id); // room with id from url params

    if (!room || room.isExpired)  // room existance
      return res.status(404).json({ success: false, message: "Room not available" });

    const isAdmin = room.admins.some(a => a.equals(req.user._id));  // check wheather the user is admin

    if (!isAdmin)  // check for admin
      return res.status(403).json({ success: false, message: "Only admins can invite" });

    const invitedUser = req.body.userId;  // user id from auth middleware

    if (!invitedUser)
      return res.status(400).json({ success: false, message: "Missing userId" });

    if (String(invitedUser) === String(req.user._id))
      return res.status(400).json({ success: false, message: "Cannot invite yourself" });

    const inviter = await User.findById(req.user._id).select("friends");

    const isFriend = inviter.friends.some(f => f.equals(invitedUser));

    if (!isFriend)
      return res.status(403).json({ success: false, message: "You can only invite friends" });

    if (room.members.some(m => m.equals(invitedUser)))
      return res.status(400).json({ success: false, message: "User already a member" });

    const hasActiveInvite = (room.inviteTokens || []).some(i =>
      String(i.invitedUser) === String(invitedUser) &&
      !i.used &&
      i.expiresAt > new Date()
    );

    if (hasActiveInvite)
      return res.status(400).json({ success: false, message: "Active invitation exists" });

    if (room.maxMembers && room.members.length >= room.maxMembers)
      return res.status(400).json({ success: false, message: "Room is full" });

    const token = crypto.randomBytes(16).toString("hex");

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    room.inviteTokens.push({
      token,
      invitedUser,
      expiresAt,
      used: false
    });

    const notification = await Notification.create({
      receiver:invitedUser,
      sender:req.user._id,
      type:"room_invite",
      roomId:room._id,
      inviteToken: token
    });

    // Emit socket event for new notification
    const receiverSocketIds = globalThis.userSocketMap && globalThis.userSocketMap[invitedUser];
    if (receiverSocketIds && globalThis.io) {
      const populatedNotification = await Notification.findById(notification._id).populate("sender","fullName profilePic");
      receiverSocketIds.forEach(socketId => {
        globalThis.io.to(socketId).emit("newNotification", populatedNotification);
      });
    }

    await room.save();
    const baseUrl = process.env.APP_URL || "http://localhost:3000";

    res.json({
      success: true,
      token,
      inviteUrl: `${baseUrl}/rooms/join?room=${room._id}&t=${token}`
    });
  } catch (e) {
    console.error("inviteFriend:", e);  
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const acceptInvite = async (req, res) => {
  try {
    const { roomId, token } = req.body;
    const room = await Room.findById(roomId);
    if (!room || room.isExpired)
      return res.status(404).json({ success: false, message: "Room not available" });
    const item = (room.inviteTokens || []).find(i =>
      i.token === token && !i.used && i.expiresAt > new Date()
    );
    if (!item)
      return res.status(400).json({ success: false, message: "Invalid or expired invite" });

    const uid = String(req.user._id);

    const invitedUserStr = item.invitedUser ? String(item.invitedUser) : null;

    if (invitedUserStr && invitedUserStr !== uid)
      return res.status(403).json({ success: false, message: "Invite not for you" });

    if (room.maxMembers && room.members.length >= room.maxMembers)
      return res.status(400).json({ success: false, message: "Room is full" });

    const wasMember = room.members.map(String).includes(uid);

    if (!wasMember)
      room.members.push(uid);

    item.used = true;

    await room.save();

    const msg = await RoomMessage.create({
      roomId: room._id,
      senderId: uid,
      text: `${req.user.fullName} joined via invite`,
      system: true
    });

    if (globalThis.io) {

      globalThis.io.to(`room:${room._id}`).emit("room:message", msg);

      if (!wasMember) {

        globalThis.io.to(`room:${room._id}`).emit("room:member_joined", {
          roomId: room._id.toString(),
          userId: uid
        });

      }

    }

    res.json({ success: true, room });

  } catch (e) {

    console.error("acceptInvite:", e);

    res.status(500).json({ success: false, message: "Server error" });

  }
};

export const rejectInvite = async (req, res) => {

  try {

    const { roomId, token } = req.body;

    const room = await Room.findById(roomId);

    if (!room) return res.status(404).json({ success: false, message: "Room not found" });

    const uid = req.user._id.toString();

    const item = (room.inviteTokens || []).find(i =>
      i.token === token &&
      i.invitedUser?.toString() === uid &&
      !i.used &&
      i.expiresAt > new Date()
    );

    if (!item) return res.status(400).json({ success: false, message: "Invite not found" });
    item.used = true;
    await room.save();
    res.json({ success: true, message: "Invitation declined" });
  } catch (e) {
    console.error("rejectInvite:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getRoomMessages = async (req, res) => {

  try {
    const room = await Room.findById(req.params.id);
    if (!room || room.isExpired) return res.status(404).json({ success: false, message: "Room not available" });
    const isMember = room.members.map(String).includes(req.user._id.toString());
    if (!isMember) return res.status(403).json({ success: false, message: "Not a member" });
    const messages = await RoomMessage.find({
      roomId: room._id,
      archived: { $ne: true },
      deletedFor: { $ne: req.user._id }
    })
      .populate("senderId", "fullName profilePic")
      .sort({ createdAt: 1 });
    res.json({ success: true, messages });
  } catch (e) {
    console.error("getRoomMessages:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const sendRoomMessage = async (req, res) => {

  try {
    const room = await Room.findById(req.params.id);
    if (!room || room.isExpired) return res.status(404).json({ success: false, message: "Room not available" });
    const uid = req.user._id.toString();
    if (!room.members.map(String).includes(uid)) return res.status(403).json({ success: false, message: "Not a member" });
    const { text, image, file } = req.body;
    if (!text && !image && !(file && file.url)) return res.status(400).json({ success: false, message: "Message cannot be empty" });

    let imageUrl;
    let filePayload;

    if (image) {
      try {
        if (
          process.env.CLOUDINARY_CLOUD_NAME &&
          process.env.CLOUDINARY_API_KEY &&
          process.env.CLOUDINARY_API_SECRET
        ) {

          const up = await cloudinary.uploader.upload(image, {
            resource_type: "auto",
            folder: "chat_app/rooms"
          });

          imageUrl = up.secure_url;
        } else {
          imageUrl = image;
        }

      } catch {
        imageUrl = image;
      }
    }

    if (file && file.url) filePayload = file;

    const msg = await RoomMessage.create({
      roomId: room._id,
      senderId: uid,
      text,
      image: imageUrl,
      file: filePayload
    });

    const populatedMsg = await RoomMessage.findById(msg._id).populate("senderId", "fullName profilePic");

    if (globalThis.io)
      globalThis.io.to(`room:${room._id}`).emit("room:message", populatedMsg);
    res.status(201).json({ success: true, message: populatedMsg });
  } catch (e) {
    console.error("sendRoomMessage:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getRoomPresence = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id).populate("members", "fullName profilePic");
    if (!room || room.isExpired) return res.status(404).json({ success: false, message: "Room not available" });
    
    const members = room.members;
    const presentIds = Array.from((globalThis.roomPresence?.[room._id] || new Set()).values()).map(String);
    
    const present = members.filter(m => presentIds.includes(m._id.toString()));
    const absent = members.filter(m => !presentIds.includes(m._id.toString()));
    
    res.json({ success: true, present, absent, members });
  } catch (e) {
    console.error("getRoomPresence:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const adminAddMember = async (req, res) => {

  try {
    const room = await Room.findById(req.params.id);
    if (!room || room.isExpired) return res.status(404).json({ success: false, message: "Room not available" });

    const isAdmin = room.admins.map(String).includes(req.user._id.toString());
    if (!isAdmin) return res.status(403).json({ success: false, message: "Only admins can add members" });

    const userId = req.body.userId;
    if (!userId) return res.status(400).json({ success: false, message: "Missing userId" });
    if (room.members.map(String).includes(userId)) return res.json({ success: true, room });
    if(room.maxMembers && room.members.length >= room.maxMembers) return res.status(400).json({ success: false, message: "Room is full" });
    room.members.push(userId);
    await room.save();

    const sys = await RoomMessage.create({
      roomId: room._id,
      senderId: req.user._id,
      text: "A member was added",
      system: true
    });

    if (globalThis.io) globalThis.io.to(`room:${room._id}`).emit("room:message", sys);
    res.json({ success: true, room });
  } catch (e) {
    console.error("adminAddMember:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const adminRemoveMember = async (req, res) => {

  try {
    const room = await Room.findById(req.params.id);
    if (!room || room.isExpired) return res.status(404).json({ success: false, message: "Room not available" });
    const isAdmin = room.admins.some(a => a.equals(req.user._id));
    if (!isAdmin) return res.status(403).json({ success: false, message: "Only admins can remove members" });
    const userId = req.params.userId;
    if (String(userId) === String(room.creatorId)) return res.status(400).json({ success: false, message: "Cannot remove room creator" });
    room.members = room.members.filter(m => String(m) !== String(userId));
    await room.save();

    if (globalThis.io) {
      globalThis.io.to(`room:${room._id}`).emit("room:member_removed", {
        roomId: room._id.toString(),
        userId
      });
    }
    res.json({ success: true, room });
  } catch (e) {
    console.error("adminRemoveMember:", e);
    res.status(500).json({ success: false, message: "Server error" });

  }
};



export const updateRoomTimer = async (req, res) => {
  try {
    const roomId = req.params.id;
    const minutes = Number(req.body.expiryTime);

    if (!minutes || minutes < 1) return res.status(400).json({ success: false, message: "Invalid expiryTime" });
    const room = await Room.findById(roomId);

    if (!room || room.isExpired) return res.status(404).json({ success: false, message: "Room not available" });
    const isAdmin = room.admins.map(String).includes(req.user._id.toString());

    if (!isAdmin) return res.status(403).json({ success: false, message: "Only admins can update timer" });
    room.expiresAt = new Date(Date.now() + minutes * 60 * 1000);
    await room.save();
    if (globalThis.io) {
      globalThis.io.to(`room:${room._id}`).emit("room:timer", {
        roomId: room._id.toString(),
        expiresAt: room.expiresAt
      });
    }

    res.json({ success: true, room });
  } catch (e) {
    console.error("updateRoomTimer:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const deleteRoomMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { deleteType } = req.body; // "forMe" or "forEveryone"
    const userId = req.user._id;

    const message = await RoomMessage.findById(id);

    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found" });
    }

    const room = await Room.findById(message.roomId);

    if (!room) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    // Only sender or room admin can delete the message for everyone
    const isAdmin = room.admins.map(String).includes(userId.toString());
    const isSender = message.senderId.toString() === userId.toString();

    if (deleteType === "forMe") {
      // Push to deletedFor array
      if (!message.deletedFor.includes(userId)) {
          message.deletedFor.push(userId);
          await message.save();
      }

      // Emit to ONLY the user who requested the delete
      if (globalThis.io) {
          const requestorSocketIds = globalThis.userSocketMap && globalThis.userSocketMap[userId];
          if (requestorSocketIds) {
              requestorSocketIds.forEach(socketId => {
                  globalThis.io.to(socketId).emit("room:messageDeletedForMe", id);
              });
          }
      }
      return res.status(200).json({ success: true, message: "Room message deleted for you" });

    } else if (deleteType === "forEveryone") {
      if (!isSender && !isAdmin) {
        return res.status(403).json({ success: false, message: "Unauthorized to delete this message for everyone" });
      }

      message.isDeletedForEveryone = true;
      message.text = "";
      message.image = "";
      if (message.file) {
        message.file = null;
      }
      await message.save();

      // Notify all members in the room via socket
      if (globalThis.io) {
        globalThis.io.to(`room:${room._id}`).emit("room:messageDeletedForEveryone", { id, isDeletedForEveryone: true });
      }

      return res.status(200).json({ success: true, message: "Room message deleted for everyone" });
    }

    return res.status(400).json({ success: false, message: "Invalid deleteType" });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


const genAI = process.env.GEMINI_API_KEY?.trim()
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY.trim())
  : null;

const openai = process.env.OPENAI_API_KEY?.trim()
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY.trim() })
  : null;

const MAX_TEXT_LENGTH = 4000;

export const summarizeRoomMessages = async (req, res) => {
  try {
    const { id } = req.params;

    const room = await Room.findById(id);

    // Use explicit date comparison if isExpired is not a stored boolean
    if (!room || room.isExpired) {
      return res.status(404).json({
        success: false,
        message: "Room not found"
      });
    }

    const messages = await RoomMessage.find({
      roomId: id,
      system: { $ne: true }
    })
      .sort({ createdAt: 1 })  // fetch oldest-first — no need to reverse later
      .limit(20);


    if (messages.length === 0) {
      return res.json({
        success: true,
        summary: "No messages to summarize."
      });
    }

    const textMessages = messages
      .map(m => m.text?.trim())
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_TEXT_LENGTH);  // guard against oversized AI payloads

    if (!textMessages.trim()) {
      return res.json({
        success: true,
        summary:
          "No text messages found to summarize (messages might be only images or empty)."
      });
    }

    console.log(textMessages);

    let summary = "";
    let debugInfo = "";

    // --- Gemini (primary) ---
    if (genAI) {
      try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const result = await model.generateContent(
          `Summarize the following chat conversation in 2-3 concise sentences highlighting the key points:\n\n${textMessages}`
        );

        if (result?.response) {
          summary = result.response.text().trim();
        }
      } catch (geminiError) {
        console.error("Gemini Summarization Error:", geminiError);
        debugInfo += `Gemini error: ${geminiError.message || "Unknown error"}. `;
      }
    } else {
      debugInfo += "Gemini API key missing or client not initialized. ";
    }

    // --- OpenAI (fallback) ---
    if (!summary) {
      if (openai) {
        try {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: "You summarize chat conversations briefly and clearly."
              },
              {
                role: "user",
                content: `Summarize this chat conversation:\n\n${textMessages}`
              }
            ],
            max_tokens: 120
          });

          summary = completion?.choices?.[0]?.message?.content?.trim() || "";
        } catch (openaiError) {
          console.error("OpenAI Summarization Error:", openaiError);
          debugInfo += `OpenAI error: ${openaiError.message || "Unknown error"}. `;
        }
      } else {
        debugInfo += "OpenAI API key missing or client not initialized. ";
      }
    }


    
    if (!summary) {
      return res.json({
        success: false,
        summary: `AI summarization failed. ${debugInfo}`
      });
    }

    return res.json({
      success: true,
      summary
    });
  } catch (error) {
    console.error("summarizeRoomMessages:", error.message);
    // console.log(error);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};
