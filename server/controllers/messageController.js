import User from "../models/User.js";
import Message from "../models/Message.js";
import cloudinary from "../lib/cloudinary.js";
import Notification from "../models/Notification.js";
// Avoid circular import of server by reading socket server from globalThis


// Get all users except the logged-in user (for sidebar)
export const getUsersForSidebar = async (req, res) => {
    try {
        const userId = req.user._id;
        const currentUser = await User.findById(userId);

        // Get all users except current user and exclude password field to keep it secure
        const filteredUsers = await User.find({  
            _id: { $ne: userId }
        }).select("-password");

        // Store unseen message count per user
        const unseenMessages = {};

        // Precompute sets for faster and correct membership checks

        // i am converting the ObjectId to string because the ObjectId is an object and when we compare 
        // it with the user._id which is also an ObjectId it will not work because they are different objects
        //  in memory even if they have the same value but when we convert them to string it will compare the values correctly
        const friendsSet = new Set((currentUser.friends || []).map(id => id.toString()));
        const receivedSet = new Set((currentUser.friendRequests || []).map(id => id.toString()));
        const sentSet = new Set((currentUser.sentRequests || []).map(id => id.toString()));
        const blockedSet = new Set((currentUser.blockedUsers || []).map(id => id.toString()));

        // Process users to add friend status and count unseen messages
        const usersWithStatus = await Promise.all(filteredUsers.map(async (user) => {
            const messages = await Message.find({
                senderId: user._id,
                receiverId: userId,
                seen: false,
            });

            if (messages.length > 0) {
                unseenMessages[user._id] = messages.length;
            }

            // Determine status (compare by string equality)
            const uid = user._id.toString();
            let status = "none";
            if (friendsSet.has(uid)) status = "friend";
            else if (receivedSet.has(uid)) status = "received";
            else if (sentSet.has(uid)) status = "sent";
            else if (blockedSet.has(uid)) status = "blocked";

            return { ...user.toObject(), friendStatus: status };
        }));

        res.status(200).json({
            success: true,
            users: usersWithStatus,
            unseenMessages,
        });

    } catch (error) {
        console.error("GET USERS FOR SIDEBAR ERROR:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message, stack: error.stack });
    }
};


// Get all messages for selected user
export const getMessages = async (req, res) => {
    try {
        const { id: selectedUserId } = req.params;
        const myId = req.user._id;

        // Fetch all messages between logged-in user and selected user that aren't deleted for the logged-in user
        const messages = await Message.find({
            $and: [
                {
                    $or: [
                        { senderId: myId, receiverId: selectedUserId },
                        { senderId: selectedUserId, receiverId: myId }
                    ]
                },
                { deletedFor: { $ne: myId } }
            ]
        });

        // Mark messages as seen
        await Message.updateMany(
            { senderId: selectedUserId, receiverId: myId },
            { seen: true }
        );

        res.status(200).json({
            success: true,
            messages,
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};



// API to mark a message as seen using message ID
export const markMessageAsSeen = async (req, res) => {
    try {
        const { id } = req.params;

        await Message.findByIdAndUpdate(
            id,
            { seen: true },
            { new: true }
        );

        res.status(200).json({ success: true });

    } catch (error) {
        console.error(error.message);
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


// Send a message (text / image)
export const sendMessage = async (req, res) => {
    try {
        const { text, image } = req.body;
        const receiverId = req.params.id;
        const senderId = req.user._id;

        // Check friendship status
        const sender = await User.findById(senderId);
        if (!sender.friends.includes(receiverId)) {
             return res.status(403).json({
                success: false,
                message: "You must be friends to send messages",
            });
        }

        if (!text && !image) {
            return res.status(400).json({
                success: false,
                message: "Message must contain text or image",
            });
        }

        let imageUrl;

        // Upload image to Cloudinary if present
        if (image) {
            const hasCloudinaryCreds =
                !!process.env.CLOUDINARY_CLOUD_NAME &&
                !!process.env.CLOUDINARY_API_KEY &&
                !!process.env.CLOUDINARY_API_SECRET;

            try {
                if (hasCloudinaryCreds) {
                    const uploadResponse = await cloudinary.uploader.upload(image, {
                        resource_type: "auto",
                        folder: "chat_app/messages",
                    });
                    imageUrl = uploadResponse.secure_url;
                } else {
                    imageUrl = image;
                }
            } catch (uploadError) {
                console.error("Cloudinary upload failed:", uploadError?.message || uploadError);
                imageUrl = image;
            }
        }

        // Create new message
        const newMessage = await Message.create({
            senderId,
            receiverId,
            text,
            image: imageUrl,
        });

        // Populate the message exactly like REST API does
        const populatedMessage = await Message.findById(newMessage._id);

        // Emit the new message to both sender and receiver's sockets (use globalThis set in server)
        const receiverSocketIds = globalThis.userSocketMap && globalThis.userSocketMap[receiverId];
        const senderSocketIds = globalThis.userSocketMap && globalThis.userSocketMap[senderId];

        console.log("EMITTING newMessage to:", { receiverId, senderId, receiverSocketIds, senderSocketIds });
        console.log("EMITTING populatedMessage:", populatedMessage);

        if (receiverSocketIds && globalThis.io) {
            receiverSocketIds.forEach(socketId => {
                globalThis.io.to(socketId).emit("newMessage", populatedMessage);
            });
        }

        if (senderSocketIds && globalThis.io) {
            senderSocketIds.forEach(socketId => {
                globalThis.io.to(socketId).emit("newMessage", populatedMessage);
            });
        }

        const notification = await Notification.create({
        receiver:receiverId,
        sender:req.user._id,
        type:"message"
        })

        // Emit socket event for new notification
        if (receiverSocketIds && globalThis.io) {
            const populatedNotification = await Notification.findById(notification._id).populate("sender","fullName profilePic");
            receiverSocketIds.forEach(socketId => {
                globalThis.io.to(socketId).emit("newNotification", populatedNotification);
            });
        }


        res.status(201).json({
            success: true,
            newMessage,
        });

    } catch (error) {
        console.error(error.message);
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// Delete a message
export const deleteMessage = async (req, res) => {
    try {
        const { id } = req.params;
        const { deleteType } = req.body; // "forMe" or "forEveryone"
        const userId = req.user._id;

        const message = await Message.findById(id);

        if (!message) {
            return res.status(404).json({ success: false, message: "Message not found" });
        }

        const receiverSocketIds = globalThis.userSocketMap && globalThis.userSocketMap[message.receiverId];
        const senderSocketIds = globalThis.userSocketMap && globalThis.userSocketMap[message.senderId];

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
                        globalThis.io.to(socketId).emit("messageDeletedForMe", id);
                    });
                }
            }
            return res.status(200).json({ success: true, message: "Message deleted for you" });

        } else if (deleteType === "forEveryone") {
            // Only sender can delete their message for everyone
            if (message.senderId.toString() !== userId.toString()) {
                return res.status(403).json({ success: false, message: "Unauthorized to delete this message for everyone" });
            }

            message.isDeletedForEveryone = true;
            message.text = "";
            message.image = "";
            await message.save();

            // Notify both sender and receiver via socket
            if (globalThis.io) {
                if (receiverSocketIds) {
                    receiverSocketIds.forEach(socketId => {
                        globalThis.io.to(socketId).emit("messageDeletedForEveryone", { id, isDeletedForEveryone: true });
                    });
                }
                if (senderSocketIds) {
                    senderSocketIds.forEach(socketId => {
                        globalThis.io.to(socketId).emit("messageDeletedForEveryone", { id, isDeletedForEveryone: true });
                    });
                }
            }

            return res.status(200).json({ success: true, message: "Message deleted for everyone" });
        }

        return res.status(400).json({ success: false, message: "Invalid deleteType" });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
};
