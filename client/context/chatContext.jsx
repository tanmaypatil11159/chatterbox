import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { toast } from "react-hot-toast";
import { AuthContext } from "./authContext";

export const ChatContext = createContext();

export const ChatProvider = ({ children }) => {
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [unseenMessages, setUnseenMessages] = useState({});

  const { socket, axios, authUser } = useContext(AuthContext);

  // FIX 1: Use a ref so socket handlers always read the latest selectedUser
  // without needing to be re-registered on every change.
  const selectedUserRef = useRef(selectedUser);
  const authUserRef = useRef(authUser);
  useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);
  useEffect(() => { authUserRef.current = authUser; }, [authUser]);

  // get all users for sidebar
  const getUsers = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/messages/users");
      if (data.success) {
        setUsers(data.users);
        setUnseenMessages(data.unseenMessages);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  }, [axios]);

  // ================= FRIEND ACTIONS =================
  const sendFriendRequest = async (userId) => {
    try {
      const { data } = await axios.post(`/api/friends/request/${userId}`);
      if (data.success) {
        toast.success(data.message);
        getUsers();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const acceptFriendRequest = async (userId) => {
    try {
      const { data } = await axios.post(`/api/friends/accept/${userId}`);
      if (data.success) {
        toast.success(data.message);
        getUsers();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const rejectFriendRequest = async (userId) => {
    try {
      const { data } = await axios.post(`/api/friends/reject/${userId}`);
      if (data.success) {
        toast.success(data.message);
        getUsers();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const unfriend = async (userId) => {
    try {
      const { data } = await axios.post(`/api/friends/unfriend/${userId}`);
      if (data.success) {
        toast.success(data.message);
        getUsers();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const blockUser = async (userId) => {
    try {
      const { data } = await axios.post(`/api/friends/block/${userId}`);
      if (data.success) {
        toast.success(data.message);
        getUsers();
        if (selectedUserRef.current?._id === userId) setSelectedUser(null);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const unblockUser = async (userId) => {
    try {
      const { data } = await axios.post(`/api/friends/unblock/${userId}`);
      if (data.success) {
        toast.success(data.message);
        getUsers();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  };

  // ================================================

  // FIX 2: Simplified — no merge needed because messages are cleared on user
  // change before this is called, so prev is always [].
  const getMessages = useCallback(async (userId) => {
    try {
      const { data } = await axios.get(`/api/messages/${userId}`);
      if (data.success) {
        setMessages(data.messages);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  }, [axios]);

  // FIX 3 + 4: Optimistic update using the server-returned message (which has
  // a real _id), so the socket echo deduplication works correctly and the
  // message appears instantly without waiting for the socket round-trip.
  const sendMessage = async (messageData) => {
    try {
      const { data } = await axios.post(
        `/api/messages/send/${selectedUserRef.current._id}`,
        messageData
      );

      if (data.success && data.message) {
        // Optimistically add the message — socket echo will be deduplicated by _id
        setMessages((prev) => {
          const exists = prev.some(m => String(m._id) === String(data.message._id));
          return exists ? prev : [...prev, data.message];
        });
      } else if (!data.success) {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  };

  // send image helper
  const sendImage = async (file) => {
    try {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.error("Please select an image file");
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        toast.error("File too large. Max 50MB");
        return;
      }

      const toBase64 = (f) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(f);
        });

      const base64 = await toBase64(file);
      await sendMessage({ image: base64 });
      toast.success("Image sent");
    } catch (err) {
      toast.error(err?.message || "Failed to send image");
    }
  };

  // delete message
  const deleteMessage = async (messageId, deleteType) => {
    try {
      const { data } = await axios.delete(`/api/messages/${messageId}`, {
        data: { deleteType },
      });
      if (data.success) {
        if (deleteType === "forMe") {
          setMessages((prev) => prev.filter((msg) => String(msg._id) !== String(messageId)));
        } else {
          setMessages((prev) =>
            prev.map((msg) =>
              String(msg._id) === String(messageId)
                ? { ...msg, isDeletedForEveryone: true, text: "", image: "" }
                : msg
            )
          );
        }
        toast.success(data.message || "Message deleted");
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  };

  // ================= SOCKET LISTENERS =================
  // FIX 1 continued: No deps on selectedUser/authUser — read from refs instead.
  // Socket handlers are registered once and never need to be re-registered.
  const onNewMessage = useCallback((newMessage) => {
    if (!newMessage) return;

    const senderId = typeof newMessage.senderId === "object"
      ? String(newMessage.senderId._id)
      : String(newMessage.senderId);
    const receiverId = typeof newMessage.receiverId === "object"
      ? String(newMessage.receiverId._id)
      : String(newMessage.receiverId);

    const currentUser = selectedUserRef.current;
    const selectedId = currentUser ? String(currentUser._id) : null;

    const isCurrentChat = selectedId && (
      senderId === selectedId || receiverId === selectedId
    );

    if (isCurrentChat) {
      setMessages((prev) => {
        const exists = prev.some(msg => String(msg._id) === String(newMessage._id));
        return exists ? prev : [...prev, newMessage];
      });

      if (senderId === selectedId) {
        axios.put(`/api/messages/mark/${newMessage._id}`);
      }
    } else {
      const myId = authUserRef.current ? String(authUserRef.current._id) : null;
      if (myId && senderId !== myId) {
        setUnseenMessages((prev) => ({
          ...prev,
          [senderId]: (prev[senderId] ?? 0) + 1,
        }));
      }
    }
  }, [axios]); // axios is stable; selectedUser/authUser read via refs

  const onMessageDeletedForMe = useCallback((messageId) => {
    setMessages((prev) => prev.filter((msg) => String(msg._id) !== String(messageId)));
  }, []);

  const onMessageDeletedForEveryone = useCallback(({ id }) => {
    setMessages((prev) =>
      prev.map((msg) =>
        String(msg._id) === String(id)
          ? { ...msg, isDeletedForEveryone: true, text: "", image: "" }
          : msg
      )
    );
  }, []);

  // Register socket listeners once
  useEffect(() => {
    if (!socket) return;

    socket.on("newMessage", onNewMessage);
    socket.on("messageDeletedForMe", onMessageDeletedForMe);
    socket.on("messageDeletedForEveryone", onMessageDeletedForEveryone);

    return () => {
      socket.off("newMessage", onNewMessage);
      socket.off("messageDeletedForMe", onMessageDeletedForMe);
      socket.off("messageDeletedForEveryone", onMessageDeletedForEveryone);
    };
  }, [socket, onNewMessage, onMessageDeletedForMe, onMessageDeletedForEveryone]);

  // Load users on mount
  useEffect(() => {
    getUsers();
  }, [getUsers]);

  // Clear messages when switching conversations
  useEffect(() => {
    setMessages([]);
  }, [selectedUser?._id]);

  // Reset on auth change
  useEffect(() => {
    setSelectedUser(null);
    setMessages([]);
  }, [authUser]);

  const value = {
    messages,
    users,
    selectedUser,
    getUsers,
    getMessages,
    setMessages,
    sendMessage,
    deleteMessage,
    sendImage,
    setSelectedUser,
    isRightSidebarOpen,
    setIsRightSidebarOpen,
    unseenMessages,
    setUnseenMessages,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    unfriend,
    blockUser,
    unblockUser,
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
};