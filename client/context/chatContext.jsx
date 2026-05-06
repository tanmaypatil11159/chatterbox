import { createContext, useContext, useEffect, useState, useCallback } from "react";
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
        getUsers(); // Refresh to update status
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
        getUsers(); // Refresh
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
        getUsers(); // Refresh
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
        getUsers(); // Refresh
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
        getUsers(); // Refresh
        if (selectedUser?._id === userId) setSelectedUser(null);
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
        getUsers(); // Refresh
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  }

  // ================================================

  // get messages of selected user
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

  // send message to selected user
  const sendMessage = async (messageData) => {
    try {
      const { data } = await axios.post(
        `/api/messages/send/${selectedUser._id}`,
        messageData
      );

      if (!data.success) {
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
        data: { deleteType }
      });
      if (data.success) {
        if (deleteType === "forMe") {
          setMessages((prev) => prev.filter((msg) => msg._id !== messageId));
        } else {
          setMessages((prev) =>
            prev.map((msg) =>
              msg._id === messageId
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

  // subscribe to socket messages with useCallback to prevent duplicates
  const onNewMessage = useCallback((newMessage) => {

  if (!newMessage) return;

  const senderId =
    typeof newMessage.senderId === "object"
      ? newMessage.senderId._id
      : newMessage.senderId;

  const receiverId =
    typeof newMessage.receiverId === "object"
      ? newMessage.receiverId._id
      : newMessage.receiverId;

  const selectedId = selectedUser?._id;

  const isCurrentChat =
    String(senderId) === String(selectedId) ||
    String(receiverId) === String(selectedId);

  if (isCurrentChat) {

    setMessages((prev) => {

      const exists = prev.some(
        (msg) => String(msg._id) === String(newMessage._id)
      );

      if (exists) return prev;

      return [...prev, newMessage];
    });

    if (String(senderId) === String(selectedId)) {
      axios.put(`/api/messages/mark/${newMessage._id}`);
    }

  } else {

    setUnseenMessages((prev) => ({
      ...prev,
      [senderId]: prev[senderId]
        ? prev[senderId] + 1
        : 1,
    }));

  }

}, [selectedUser, axios]);

  const onMessageDeletedForMe = useCallback((messageId) => {
    setMessages((prev) => prev.filter((msg) => msg._id !== messageId));
  }, []);

  const onMessageDeletedForEveryone = useCallback(({ id }) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg._id === id
          ? { ...msg, isDeletedForEveryone: true, text: "", image: "" }
          : msg
      )
    );
  }, []);

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

  // Load users when component mounts and when socket connects
  useEffect(() => {
    getUsers();
  }, [getUsers, socket]);

  // reset selection on auth change to avoid cross-account leakage
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
    unblockUser
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
};
