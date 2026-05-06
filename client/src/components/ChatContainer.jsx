import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ChatContext } from "../../context/chatContext";
import { AuthContext } from "../../context/authContext";
import { formatMessageTime } from "../lib/utils";
import {
  Image,
  Menu,
  Info,
  Video,
  Trash2,
  ChevronLeft,
  Send
} from "lucide-react";

import { VideoCallContext } from "../../context/VideoCallContext";

function ChatContainer({ onOpenLeft }) {
  const { authUser, onlineUsers } = useContext(AuthContext);
  const {
    messages,
    sendMessage,
    sendImage,
    getMessages,
    selectedUser,
    setSelectedUser,
    setMessages,
    deleteMessage,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    unfriend,
    blockUser,
    unblockUser
  } = useContext(ChatContext);
  const { startCall } = useContext(VideoCallContext);

  console.log("💬 ChatContainer - messages state:", messages);

  const [input, setInput] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [deletingMsgId, setDeletingMsgId] = useState(null);

  const menuRef = useRef(null);
  const scrollEnd = useRef(null);

  const friendStatus = selectedUser?.friendStatus;
  const isFriend = friendStatus === "friend";



  // =========================
  // FETCH MESSAGES ONLY ON CHAT CHANGE
  // =========================

  useEffect(() => {
    console.log("📥 ChatContainer - useEffect for getMessages triggered");
    
    if (!selectedUser?._id) return;

    getMessages(selectedUser._id);

  }, [selectedUser?._id, getMessages]);



  // =========================
  // CLOSE MENU ON OUTSIDE CLICK
  // =========================

  useEffect(() => {

    const handler = (e) => {

      if (
        menuRef.current &&
        !menuRef.current.contains(e.target)
      ) {
        setShowMenu(false);
      }

    };

    document.addEventListener("mousedown", handler);

    return () => {
      document.removeEventListener("mousedown", handler);
    };

  }, []);



  // =========================
  // FILTER CURRENT CHAT MESSAGES
  // =========================

  const filteredMessages = useMemo(() => {
    console.log("🔍 ChatContainer - filteredMessages calculated, messages length:", messages.length);
    
    if (!selectedUser?._id) return [];

    return messages.filter((msg) => {

      const senderId =
        typeof msg.senderId === "object"
          ? msg.senderId._id
          : msg.senderId;

      const receiverId =
        typeof msg.receiverId === "object"
          ? msg.receiverId._id
          : msg.receiverId;

      return (
        String(senderId) === String(selectedUser._id) ||
        String(receiverId) === String(selectedUser._id)
      );

    });

  }, [messages, selectedUser]);



  // =========================
  // AUTO SCROLL
  // =========================

  useEffect(() => {

    scrollEnd.current?.scrollIntoView({
      behavior: "smooth"
    });

  }, [filteredMessages]);



  // =========================
  // SEND IMAGE
  // =========================

  const handleImageSend = (e) => {

    const file = e.target.files[0];

    if (!file) return;

    sendImage(file);

    e.target.value = "";

  };



  // =========================
  // NO CHAT SELECTED
  // =========================

  if (!selectedUser) {

    return (

      <div className="cartoon-panel_3 flex items-center justify-center h-full relative overflow-hidden">

        <button
          type="button"
          onClick={onOpenLeft}
          className="absolute top-4 left-4 cartoon-btn p-2 md:hidden"
        >
          <Menu size={24} />
        </button>

        <p className="text-xl md:text-3xl font-extrabold text-gray-500">
          Select a chat
        </p>

      </div>

    );

  }



  return (

    <div className="cartoon-panel_3 border-l-0 flex flex-col h-full relative overflow-hidden bg-white">

      {/* ================= HEADER ================= */}

      <div className="flex items-center gap-2 sm:gap-3 border-b-4 border-black p-3 sm:p-4 relative bg-[var(--header)]">

        <button
          type="button"
          onClick={onOpenLeft}
          className="
            md:hidden
            flex items-center justify-center
            w-9 h-9
            rounded-full
            bg-[var(--card)]
            text-[var(--text)]
          "
        >
          <ChevronLeft size={18} />
        </button>

        <img
          src={
            selectedUser?.profilePic ||
            `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(
              selectedUser?.fullName || "U"
            )}`
          }
          className="w-10 h-10 sm:w-12 sm:h-12 rounded-full object-cover border-2 border-black"
        />

        <div className="flex flex-col min-w-0">

          <p className="font-extrabold text-base sm:text-lg truncate">
            {selectedUser.fullName}
          </p>

          <p
            className={`text-[10px] sm:text-xs font-bold ${
              onlineUsers.includes(selectedUser._id)
                ? "text-green-600"
                : "text-gray-500"
            }`}
          >
            {
              onlineUsers.includes(selectedUser._id)
                ? "● Online"
                : "○ Offline"
            }
          </p>

        </div>

        <div className="ml-auto flex items-center gap-2">

          {isFriend && (
            <button
              type="button"
              onClick={() => startCall(selectedUser)}
              className="saas-btn bg-[var(--primary)] text-white p-2"
            >
              <Video size={18} />
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowMenu((v) => !v)}
            className="saas-btn p-2 bg-red-500 text-white"
          >
            <Info size={18} />
          </button>

        </div>

      </div>



      {/* ================= MESSAGES ================= */}

      <div className="flex-1 overflow-y-scroll px-4 py-4 flex flex-col gap-4 messages-area">

        {filteredMessages.map((msg, index) => {

          const senderId =
            typeof msg.senderId === "object"
              ? msg.senderId._id
              : msg.senderId;

          const isMe =
            String(senderId) === String(authUser?._id);

          const msgDate =
            new Date(msg.createdAt).toDateString();

          const prevMsgDate =
            index > 0
              ? new Date(filteredMessages[index - 1].createdAt).toDateString()
              : null;

          const showDateSeparator =
            msgDate !== prevMsgDate;

          return (

            <React.Fragment key={String(msg._id)}>

              {showDateSeparator && (
                <div className="flex items-center justify-center my-4">

                  <div className="bg-gray-200 border-2 border-black rounded-full px-4 py-1 text-xs font-bold">

                    {new Date(msg.createdAt).toLocaleDateString(undefined, {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric"
                    })}

                  </div>

                </div>
              )}

              <div
                className={`max-w-[85%] sm:max-w-[70%] ${
                  isMe
                    ? "ml-auto items-end"
                    : "mr-auto items-start"
                } flex flex-col`}
              >

                {msg.image ? (

                  <img
                    src={msg.image}
                    className="max-w-full sm:max-w-[220px] rounded-xl border-2 sm:border-4 border-black"
                  />

                ) : (

                  <div
                    className={`
                      border-2 sm:border-4 border-black
                      rounded-2xl sm:rounded-3xl
                      px-3 py-2
                      font-bold text-sm sm:text-base
                      ${
                        isMe
                          ? "rounded-br-none ml-auto"
                          : "rounded-bl-none mr-auto"
                      }
                    `}
                    style={{
                      background:
                        isMe
                          ? "var(--sent)"
                          : "var(--received)"
                    }}
                  >
                    {msg.text}
                  </div>

                )}

                <p
                  className={`text-[10px] sm:text-xs font-bold mt-1 ${
                    isMe
                      ? "text-right"
                      : "text-left"
                  }`}
                >
                  {formatMessageTime(msg.createdAt)}
                </p>

              </div>

            </React.Fragment>

          );

        })}

        <div ref={scrollEnd} />

      </div>



      {/* ================= INPUT ================= */}

      {!isFriend && (

        <div className="p-3 text-center text-sm text-orange-700 bg-orange-100 border-t-4 border-black">

          You must be friends to chat.

        </div>

      )}

      <form
        onSubmit={(e) => {

          e.preventDefault();

          if (!isFriend || !input.trim()) return;

          sendMessage({ text: input });

          setInput("");

        }}
        className="border-t-4 border-black p-2 sm:p-3 flex gap-2 items-center"
      >

        <label
          htmlFor="imageUpload"
          className="
            w-10 h-10 sm:w-12 sm:h-12
            rounded-full
            flex items-center justify-center
            cursor-pointer
            bg-[var(--primary)]
            text-white
            border-2 border-black
          "
        >
          <Image size={20} />
        </label>

        <input
          id="imageUpload"
          type="file"
          hidden
          onChange={handleImageSend}
          disabled={!isFriend}
        />

        <input
          className="cartoon-input flex-1 py-2 sm:py-3 text-sm sm:text-base"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            isFriend
              ? "Type message..."
              : "Add friend to start"
          }
          disabled={!isFriend}
        />

        <button
          type="submit"
          disabled={!isFriend || !input.trim()}
          className="
            w-10 h-10 sm:w-12 sm:h-12
            rounded-full
            flex items-center justify-center
            border-2 border-black
            bg-green-500 text-white
          "
        >
          <Send size={20} />
        </button>

      </form>

    </div>

  );

}

export default ChatContainer;