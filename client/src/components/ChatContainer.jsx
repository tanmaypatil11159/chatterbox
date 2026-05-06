import React, { useContext, useEffect, useRef, useState } from "react";
import { ChatContext } from "../../context/chatContext";
import { AuthContext } from "../../context/authContext";
import { formatMessageTime } from "../lib/utils";
import { Image, Menu, Info, Video, Trash2, ChevronLeft, Send } from "lucide-react";
import { VideoCallContext } from "../../context/VideoCallContext";
import { NavLink } from "react-router-dom";
// import {ThemeSelector} from "./ThemeSelector";


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



  const [input, setInput] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [deletingMsgId, setDeletingMsgId] = useState(null);
  const menuRef = useRef(null);
  const scrollEnd = useRef(null);

  const friendStatus = selectedUser?.friendStatus;
  const isFriend = friendStatus === "friend";

  /* close popup on outside click */
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
   if (!socket) return;

   const handleNewMessage = (msg) => {
      if (
         selectedUser &&
         (
            msg.senderId === selectedUser._id ||
            msg.receiverId === selectedUser._id
         )
      ) {
         setMessages(prev => [...prev, msg]);
      }
   };

   socket.on("newMessage", handleNewMessage);

   return () => {
      socket.off("newMessage", handleNewMessage);
   };
}, [socket, selectedUser]);

  /* fetch messages */
  useEffect(() => {
    if (!selectedUser || selectedUser.friendStatus !== "friend") {
      setMessages([]);
      return;
    }

    getMessages(selectedUser._id);
  }, [selectedUser, getMessages, setMessages]);

  /* auto scroll */
  useEffect(() => {
    scrollEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleImageSend = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    sendImage(file);
    e.target.value = "";
  };



  if (!selectedUser) {
    return (
      <div className="cartoon-panel_3 flex items-center justify-center h-full relative overflow-hidden">
        <button
          type="button"
          onClick={onOpenLeft}
          className="absolute top-4 left-4 cartoon-btn p-2 md:hidden"
          aria-label="Open chat sidebar"
        >
          <Menu size={24} />
        </button>
        <p className="text-xl md:text-3xl font-extrabold text-gray-500">Select a chat</p>
      </div>
    );
  }

  return (
    <div className="cartoon-panel_3 border-l-0 flex flex-col h-full relative overflow-hidden bg-white">

      {/* HEADER */}
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
  shadow-sm
  hover:bg-[var(--primary)] hover:text-white
  transition-all duration-200
  active:scale-95
  "
  aria-label="Back to chat list"
>
  <ChevronLeft size={18} />
</button>

        <img src={selectedUser?.profilePic || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(selectedUser?.fullName || selectedUser?.username || "U")}&backgroundColor=8B5CF6,4F46E5,EC4899,10B981,F59E0B`} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full object-cover border-2 border-black" />

        <div className="flex flex-col min-w-0">
          <p className="font-extrabold text-base sm:text-lg truncate leading-tight">{selectedUser.fullName}</p>
          <p className={`text-[10px] sm:text-xs font-bold truncate ${onlineUsers.includes(selectedUser._id) ? "text-green-600" : "text-gray-500"}`}>
            {onlineUsers.includes(selectedUser._id) ? "● Online" : "○ Offline"}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {isFriend && (
            <button
              type="button"
              onClick={() => startCall(selectedUser)}
              className="saas-btn bg-[var(--primary)] text-white p-1.5 sm:p-2"
              aria-label="Start video call"
            >
              <Video size={18} />
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowMenu((v) => !v)}
            className="saas-btn p-1.5 sm:p-2 bg-red-500 text-white"
            aria-label="Open chat actions"
          >
            <Info size={18} />
          </button>
        </div>

        {/* FLOATING MENU */}
        {showMenu && (
          <>
            <div
              className="fixed inset-0 bg-black/30 z-40"
              onClick={() => setShowMenu(false)}
              role="presentation"
              aria-hidden="true"
            />
            <div
              ref={menuRef}
              className="absolute top-16 right-4 w-64 bg-white border-4 border-black rounded-xl shadow-xl p-4 flex flex-col gap-3 z-50 animate-fadeIn"
              role="dialog"
              aria-modal="true"
              aria-label="Chat actions menu"
              tabIndex={-1}
            >

              <div className="flex flex-col items-center gap-2 pb-2 border-b-2 border-black">
                <img src={selectedUser?.profilePic || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(selectedUser?.fullName || selectedUser?.username || "U")}&backgroundColor=8B5CF6,4F46E5,EC4899,10B981,F59E0B`} className="w-20 h-20 rounded-full object-cover border border-black" />
                <p className="font-extrabold">{selectedUser.fullName}</p>
                <p className="text-sm text-gray-700 text-center">{selectedUser.bio || "No bio available"}</p>
              </div>

              {friendStatus === "none" && (
                <button onClick={() => sendFriendRequest(selectedUser._id)} className="cartoon-btn bg-[#A1EEBD]">Add Friend</button>
              )}

              {friendStatus === "received" && (
                <div className="flex gap-2">
                  <button onClick={() => acceptFriendRequest(selectedUser._id)} className="cartoon-btn w-full bg-[#A1EEBD]">Accept</button>
                  <button onClick={() => rejectFriendRequest(selectedUser._id)} className="cartoon-btn w-full bg-[#FF8C8C]">Reject</button>
                </div>
              )}

              {friendStatus === "friend" && (
                <button onClick={() => unfriend(selectedUser._id)} className="saas-btn bg-[#FFD93D]">Unfriend</button>
              )}

              {friendStatus === "blocked"
                ? <button onClick={() => unblockUser(selectedUser._id)} className="saas-btn bg-[#A1EEBD]">Unblock</button>
                : <button onClick={() => blockUser(selectedUser._id)} className="saas-btn bg-red-500 text-white">Block</button>
              }

            </div>
          </>
        )}

      </div>

      {/* MESSAGES */}
      <div className="flex-1 overflow-y-scroll px-4 py-4 flex flex-col gap-4 messages-area">
        {messages?.map((msg, index) => {
          const isMe = msg.senderId === authUser?._id;

          // Date separator logic
          const msgDate = new Date(msg.createdAt).toDateString();
          const prevMsgDate = index > 0 ? new Date(messages[index - 1].createdAt).toDateString() : null;
          const showDateSeparator = msgDate !== prevMsgDate;

          return (
            <React.Fragment key={msg._id || `${msg.senderId}-${msg.createdAt}`}>
              {showDateSeparator && (
                <div className="flex items-center justify-center my-4">
                  <div className="bg-gray-200 border-2 border-black rounded-full px-4 py-1 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                    {new Date(msg.createdAt).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </div>
                </div>
              )}
              <div className={`max-w-[85%] sm:max-w-[70%] ${isMe ? "ml-auto items-end" : "mr-auto items-start"} flex flex-col group relative`}>
                
                {/* TRASH CAN APPLIES TO ALL MESSAGES NOW */}
                {!msg.isDeletedForEveryone && (
                  <button
                    onClick={() => setDeletingMsgId(deletingMsgId === msg._id ? null : msg._id)}
                    className={`absolute ${isMe ? "-left-8 sm:-left-10" : "-right-8 sm:-right-10"} top-1/2 -translate-y-1/2 p-2 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity`}
                    title="Delete message"
                  >
                    <Trash2 size={14} sm:size={16} />
                  </button>
                )}

                {/* DELETE OPTIONS DROPDOWN */}
                {deletingMsgId === msg._id && !msg.isDeletedForEveryone && (
                   <div className={`absolute top-full mt-1 ${isMe ? "right-0" : "left-0"} z-20 bg-white border-2 border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-2 flex flex-col gap-1 w-40 overflow-hidden`}>
                     <button onClick={() => { deleteMessage(msg._id, "forMe"); setDeletingMsgId(null); }} className="text-sm font-bold hover:bg-gray-200 p-2 text-left w-full rounded">Delete for me</button>
                     {isMe && <button onClick={() => { deleteMessage(msg._id, "forEveryone"); setDeletingMsgId(null); }} className="text-sm font-bold hover:bg-red-100 text-red-600 p-2 text-left w-full rounded">Delete for everyone</button>}
                     <button onClick={() => setDeletingMsgId(null)} className="text-sm font-bold hover:bg-gray-100 p-2 text-left w-full rounded text-gray-500">Cancel</button>
                   </div>
                )}

                {msg.isDeletedForEveryone ? (
                   <div
                     className={`
                       border-2 sm:border-4 border-black
                       rounded-2xl sm:rounded-3xl
                       px-3 py-1.5 sm:px-4 sm:py-2
                       font-bold text-sm sm:text-base italic text-gray-500
                       ${isMe ? "rounded-br-none ml-auto bg-gray-100" : "rounded-bl-none mr-auto bg-gray-100"}
                     `}
                   >
                     🚫 This message was deleted
                   </div>
                ) : msg.image ? (
                  <img src={msg.image || `https://api.dicebear.com/9.x/initials/svg?seed=Image&backgroundColor=8B5CF6,4F46E5,EC4899,10B981,F59E0B`} className="max-w-full sm:max-w-[220px] rounded-xl border-2 sm:border-4 border-black" />
                ) : (
                  <div
                    className={`
                      border-2 sm:border-4 border-black
                      rounded-2xl sm:rounded-3xl
                      px-3 py-1.5 sm:px-4 sm:py-2
                      font-bold text-sm sm:text-base
                      ${isMe ? "rounded-br-none ml-auto" : "rounded-bl-none mr-auto"}
                    `}
                    style={{
                      background: isMe ? "var(--sent)" : "var(--received)"
                    }}
                  >
                    {msg.text}
                  </div>
                )}
                
                <p className={`text-[10px] sm:text-xs font-bold mt-1 ${isMe ? "text-right" : "text-left"}`}>{formatMessageTime(msg.createdAt)}</p>
              </div>
            </React.Fragment>
          );
        })}
        <div ref={scrollEnd} />
      </div>

      {/* INPUT */}
      {!isFriend && (
        <div className="p-3 text-center text-sm text-orange-700 bg-orange-100 border-t-4 border-black">
          You must be friends to chat. Use the menu to send a friend request.
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
          className={`
            w-10 h-10 sm:w-12 sm:h-12 
            rounded-full flex-shrink-0
            flex items-center justify-center 
            cursor-pointer transition-all duration-200
            bg-[var(--primary)] text-white 
            ${!isFriend ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-600 active:scale-90"}
            border-2 border-black
          `}
          aria-label="Upload image"
        >
          <Image size={20} />
        </label>
        <input id="imageUpload" type="file" hidden onChange={handleImageSend} disabled={!isFriend} />
        <input
          className="cartoon-input flex-1 py-2 sm:py-3 text-sm sm:text-base min-w-0"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isFriend ? "Type message..." : "Add friend to start"}
          disabled={!isFriend}
        />
        <button
  type="submit"
  disabled={!isFriend || !input.trim()}
  className={`
    w-10 h-10 sm:w-12 sm:h-12
    rounded-full flex-shrink-0
    flex items-center justify-center
    border-2 border-black
    bg-green-500 text-white
    shadow-inner
    hover:bg-green-600
    active:scale-90
    transition-all duration-200
  `}
  aria-label="Send message"
>
  <Send size={20} className="block" />
</button>
      </form>

    </div>
  );
}

export default ChatContainer;

