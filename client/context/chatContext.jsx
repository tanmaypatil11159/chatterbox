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

  // Keep refs for everything the socket handler needs so it never needs
  // to be recreated — a recreated handler causes off()+on() and any message
  // arriving in that gap is silently lost.
  const selectedUserRef = useRef(null);
  const authUserRef = useRef(null);
  const axiosRef = useRef(axios);

  useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);
  useEffect(() => { authUserRef.current = authUser; }, [authUser]);
  useEffect(() => { axiosRef.current = axios; }, [axios]);

  // ─── Users ────────────────────────────────────────────────────────────────
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

  // ─── Friend Actions ────────────────────────────────────────────────────────
  const sendFriendRequest = async (userId) => {
    try {
      const { data } = await axios.post(`/api/friends/request/${userId}`);
      if (data.success) { toast.success(data.message); getUsers(); }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const acceptFriendRequest = async (userId) => {
    try {
      const { data } = await axios.post(`/api/friends/accept/${userId}`);
      if (data.success) { toast.success(data.message); getUsers(); }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const rejectFriendRequest = async (userId) => {
    try {
      const { data } = await axios.post(`/api/friends/reject/${userId}`);
      if (data.success) { toast.success(data.message); getUsers(); }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const unfriend = async (userId) => {
    try {
      const { data } = await axios.post(`/api/friends/unfriend/${userId}`);
      if (data.success) { toast.success(data.message); getUsers(); }
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
      if (data.success) { toast.success(data.message); getUsers(); }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  };

  // ─── Messages ──────────────────────────────────────────────────────────────
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

  const sendMessage = async (messageData) => {
    try {
      const { data } = await axios.post(
        `/api/messages/send/${selectedUserRef.current._id}`,
        messageData
      );
      if (data.success && data.message) {
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

  const sendImage = async (file) => {
    try {
      if (!file) return;
      if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return; }
      if (file.size > 50 * 1024 * 1024) { toast.error("File too large. Max 50MB"); return; }
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await sendMessage({ image: base64 });
      toast.success("Image sent");
    } catch (err) {
      toast.error(err?.message || "Failed to send image");
    }
  };

  const deleteMessage = async (messageId, deleteType) => {
    try {
      const { data } = await axios.delete(`/api/messages/${messageId}`, { data: { deleteType } });
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

  // ─── Socket Listeners ──────────────────────────────────────────────────────
  // Empty deps [] — created once, reads live state via refs.
  // This guarantees no messages are lost between off()/on() cycles.
  const onNewMessage = useCallback((newMessage) => {
    if (!newMessage) return;

    const senderId = String(
      typeof newMessage.senderId === "object" ? newMessage.senderId._id : newMessage.senderId
    );
    const receiverId = String(
      typeof newMessage.receiverId === "object" ? newMessage.receiverId._id : newMessage.receiverId
    );

    const selectedId = selectedUserRef.current ? String(selectedUserRef.current._id) : null;
    const myId = authUserRef.current ? String(authUserRef.current._id) : null;

    const isCurrentChat = selectedId && (senderId === selectedId || receiverId === selectedId);

    if (isCurrentChat) {
      setMessages((prev) => {
        const exists = prev.some(msg => String(msg._id) === String(newMessage._id));
        return exists ? prev : [...prev, newMessage];
      });
      if (senderId === selectedId) {
        axiosRef.current.put(`/api/messages/mark/${newMessage._id}`);
      }
    } else if (myId && senderId !== myId) {
      setUnseenMessages((prev) => ({
        ...prev,
        [senderId]: (prev[senderId] ?? 0) + 1,
      }));
    }
  }, []); // intentionally empty

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

  // ─── Side Effects ──────────────────────────────────────────────────────────
  useEffect(() => { getUsers(); }, [getUsers]);

  useEffect(() => { setMessages([]); }, [selectedUser?._id]);

  useEffect(() => {
    setSelectedUser(null);
    setMessages([]);
  }, [authUser]);

  // ─── Context Value ─────────────────────────────────────────────────────────
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