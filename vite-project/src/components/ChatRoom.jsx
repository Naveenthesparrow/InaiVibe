import React, { useState, useEffect, useRef } from "react";
import axios from "axios";

// Import components and assets
import VideoPlayer from "../components/videoPlayer";
import SearchBox from "../components/searchBox";
import RoomMembers from "../components/Members";
import Sent from "../assets/Sent.svg";

// Get backend URL from environment variables
const backend_url = import.meta.env.VITE_BACKEND_URL;

function ChatRoom({ room, user, socket, leaveRoom, isPlaying }) {
  // State variables
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [selectedVideoId, setSelectedVideoId] = useState("");
  const [isMembersPanelOpen, setIsMembersPanelOpen] = useState(false);
  const messagesEndRef = useRef(null);

  // Effect to handle current video selection
  useEffect(() => {
    if (selectedVideoId && room.name) {
      socket.emit("set current video", {
        roomName: room.name,
        videoId: selectedVideoId,
      });
    }
  }, [selectedVideoId, room.name, socket]);

  // Effect to handle socket events and message fetching
  useEffect(() => {
    fetchMessages();

    // Socket event listeners
    socket.on("chat message", (msg) => {
      setMessages((prevMessages) => [...prevMessages, msg]);
    });

    socket.on("message deleted", (messageId) => {
      setMessages((prevMessages) =>
        prevMessages.filter((msg) => msg._id !== messageId)
      );
    });

    socket.on("message reacted", ({ messageId, reactions }) => {
      setMessages((prevMessages) =>
        prevMessages.map((msg) =>
          msg._id === messageId ? { ...msg, reactions } : msg
        )
      );
    });

    socket.on("current video changed", ({ videoId }) => {
      console.log("Video changed to:", videoId, "in room:", room.name);
      setSelectedVideoId(videoId);
    });

    // Cleanup socket listeners
    return () => {
      socket.off("chat message");
      socket.off("message deleted");
      socket.off("message reacted");
      socket.off("current video changed");
    };
  }, [socket, room]);

  // Fetch messages for the current room
  const fetchMessages = async () => {
    try {
      const response = await axios.get(`${backend_url}/messages/${room.name}`, {
        headers: { Authorization: user.token },
      });
      setMessages(response.data);
    } catch (error) {
      console.error("Error fetching messages:", error);
    }
  };

  // Send a new message
  const sendMessage = (e) => {
    e.preventDefault();
    if (message) {
      const messageData = {
        room: room.name,
        user: user.username,
        text: message,
      };

      socket.emit("chat message", messageData);
      setMessage("");
    }
  };

  // Delete a message
  const deleteMessage = async (messageId) => {
    try {
      await axios.delete(`${backend_url}/messages/${messageId}`, {
        headers: { Authorization: user.token },
      });
      socket.emit("delete message", messageId);
    } catch (error) {
      console.error("Error deleting message:", error);
    }
  };

  // React to a message
  const reactToMessage = (messageId, reaction) => {
    socket.emit("react to message", {
      messageId,
      user: user.username,
      reaction,
    });
  };

  // Toggle members panel
  const toggleMembersPanel = () => {
    setIsMembersPanelOpen(!isMembersPanelOpen);
  };

  // Handle video selection
  const handleVideoSelect = (videoId) => {
    setSelectedVideoId(videoId);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-col md:flex-row">
        {/* Desktop: Members Panel */}
        <div className="hidden md:block w-full md:w-auto md:min-w-[270px]">
          <RoomMembers
            roomId={room._id}
            leaveRoom={leaveRoom}
            roomName={room.name}
            currentuserName={user.username}
            currentuserAvt={user.avatar}
          />
        </div>

        <div className="flex flex-col w-full">
          <div className="flex flex-col md:flex-row">
            <div className="w-full">
              <VideoPlayer
                videoId={selectedVideoId}
                socket={socket}
                roomName={room.name}
              />
            </div>
            <div className="w-full md:w-1/2">
              <SearchBox onVideoSelect={handleVideoSelect} />
            </div>
          </div>

          <div className="flex flex-col">
            {/* Mobile: Members Toggle Button */}
            <button
              onClick={toggleMembersPanel}
              className="md:hidden self-end bg-black text-white p-2 rounded-lg m-2"
            >
              {isMembersPanelOpen ? "Hide Members" : "Show Members"}
            </button>

            <div className="flex flex-col-reverse md:flex-row">
              <div className="w-full max-w-full md:max-w-[63%] ml-0 md:ml-[10px]  h-[270px] mb-2 space-y-1 p-2 md:p-4 bg-[#F6F7F9] rounded-2xl">
                <div className="overflow-y-scroll h-[250px]">
                  {messages
                    .filter((msg) => msg.user !== "System")
                    .map((msg) => (
                      <div
                        key={msg._id}
                        className={`group p-2 rounded flex flex-col ${
                          msg.user === user.username
                            ? "items-end"
                            : "items-start"
                        }`}
                      >
                        <span
                          className={`text-[0.9rem] ${
                            msg.user === user.username
                              ? "text-right text-black"
                              : "text-left text-gray-600"
                          }`}
                        >
                          {msg.user}:
                        </span>

                        <div
                          className={`inline-block max-w-[70%] py-2 px-3 rounded-2xl break-words ${
                            msg.user === user.username
                              ? "bg-black text-white ml-auto text-right"
                              : "bg-white text-black mr-auto text-left"
                          }`}
                        >
                          <p className="text-[1rem]">{msg.text}</p>
                        </div>

                        {msg.file && (
                          <a
                            href={`${backend_url}/uploads/${msg.file}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500"
                          >
                            Attached File
                          </a>
                        )}

                        <div className="flex space-x-2 mt-2 group-hover:flex">
                          <button
                            onClick={() => reactToMessage(msg._id, "👍")}
                            className="text-sm"
                          >
                            👍
                          </button>
                          <button
                            onClick={() => reactToMessage(msg._id, "❤️")}
                            className="text-sm"
                          >
                            ❤️
                          </button>
                          <button
                            onClick={() => reactToMessage(msg._id, "😂")}
                            className="text-sm"
                          >
                            😂
                          </button>
                          {msg.user === user.username && (
                            <button
                              onClick={() => deleteMessage(msg._id)}
                              className="text-[0.9rem] text-red-500 mt-1"
                            >
                              Delete
                            </button>
                          )}
                        </div>

                        {msg.reactions && msg.reactions.length > 0 && (
                          <div className="text-sm text-gray-500">
                            {msg.reactions
                              .map((r) => `${r.user[0]}: ${r.reaction}`)
                              .join(", ")}
                          </div>
                        )}
                      </div>
                    ))}

                  <div ref={messagesEndRef} />
                </div>
                <form onSubmit={sendMessage} className="flex w-full mt-2">
                  <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="w-full p-2 md:p-3 border border-gray-300 bg-white rounded-3xl focus:outline-none focus:ring-1"
                    placeholder="Type a message..."
                  />
                  <button
                    type="submit"
                    className="bg-black relative p-2 md:p-4 rounded-4xl ml-2"
                  >
                    <img
                      src={Sent}
                      alt=""
                      className="w-5 h-5 md:w-auto md:h-auto"
                    />
                  </button>
                </form>
              </div>

              {/* Mobile: Conditionally render Members Panel */}
              {isMembersPanelOpen && (
                <div className="md:hidden w-full p-2">
                  <RoomMembers
                    roomId={room._id}
                    leaveRoom={leaveRoom}
                    roomName={room.name}
                    currentuserName={user.username}
                    currentuserAvt={user.avatar}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatRoom;
