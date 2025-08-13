import Message from "../models/Message.js";
import Room from "../models/Room.js";
import Playlist from "../models/Playlist.js";

export const setupSocketHandlers = (io) => {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Join a room
    socket.on("join room", async ({ roomName, userName }) => {
      try {
        const room = await Room.findOne({ name: roomName });
        if (!room) {
          socket.emit("room error", { error: "Room not found" });
          return;
        }

        if (!room.members.includes(userName)) {
          room.members.push(userName);
          await room.save();

          console.log("New member added:", userName);
          console.log("Updated members:", room.members);

          // Notify all users in the room about the new member
          io.to(roomName).emit("member joined", {
            userName,
            memberCount: room.members.length,
          });
        }

        socket.join(roomName);
        console.log("User name:", userName);
        console.log(`User joined room: ${roomName}`);

        // Send current video to new user when they join
        try {
          // Find playlist using either room or roomId depending on schema
          const playlist = await Playlist.findOne({
            $or: [{ room: roomName }, { roomId: room._id }],
          });

          if (playlist && playlist.currentVideoId) {
            socket.emit("current video changed", {
              videoId: playlist.currentVideoId,
              roomName,
              timestamp: new Date(),
            });
          }
        } catch (err) {
          console.error("Error sending current video on join:", err);
        }
      } catch (error) {
        console.error("Error joining room:", error);
        socket.emit("room error", { error: "Internal server error" });
      }
    });

    // Leave a room
    socket.on("leave room", async ({ roomName, userName }) => {
      try {
        const room = await Room.findOne({ name: roomName });
        if (!room) {
          socket.emit("room error", { error: "Room not found" });
          return;
        }

        // Remove the user from the room's members
        room.members = room.members.filter((member) => member !== userName);
        await room.save();

        socket.leave(roomName);
        console.log(`User ${userName} left room: ${roomName}`);
        console.log("Updated members:", room.members);

        // Notify remaining users about the member leaving
        io.to(roomName).emit("member left", {
          userName,
          memberCount: room.members.length,
        });
      } catch (error) {
        console.error("Error leaving room:", error);
        socket.emit("room error", { error: "Internal server error" });
      }
    });

    // Handle chat messages
    socket.on("chat message", async (msg) => {
      try {
        const message = new Message(msg);
        await message.save();
        io.to(msg.room).emit("chat message", message);
      } catch (error) {
        console.error("Error saving message:", error);
      }
    });

    // Delete a message
    socket.on("delete message", async (messageId) => {
      try {
        const message = await Message.findById(messageId);
        if (!message) {
          socket.emit("message error", { error: "Message not found" });
          return;
        }

        await Message.findByIdAndDelete(messageId);
        io.to(message.room).emit("message deleted", messageId);
      } catch (error) {
        socket.emit("message error", {
          error: "Failed to delete message",
          details: error.message,
        });
      }
    });

    // Delete a room
    socket.on("delete room", async ({ roomId, roomName }) => {
      try {
        const room = await Room.findById(roomId);
        if (!room) {
          socket.emit("room error", { error: "Room not found" });
          return;
        }

        // Delete all messages in the room
        await Message.deleteMany({ room: roomName });

        // Delete playlist associated with the room
        await Playlist.deleteMany({
          $or: [{ room: roomName }, { roomId: room._id }],
        });

        // Delete the room
        await Room.findByIdAndDelete(roomId);

        // Notify all users in the room that it was deleted
        io.to(roomName).emit("room deleted", { roomName });

        // Disconnect all users from the room
        const sockets = await io.in(roomName).fetchSockets();
        sockets.forEach((socket) => {
          socket.leave(roomName);
        });
      } catch (error) {
        console.error("Error deleting room:", error);
        socket.emit("room error", {
          error: "Failed to delete room",
          details: error.message,
        });
      }
    });

    // React to a message
    socket.on("react to message", async ({ messageId, user, reaction }) => {
      try {
        const message = await Message.findById(messageId);
        if (!message) {
          socket.emit("message error", { error: "Message not found" });
          return;
        }

        const existingReactionIndex = message.reactions.findIndex(
          (r) => r.user === user
        );
        if (existingReactionIndex !== -1) {
          message.reactions[existingReactionIndex].reaction = reaction;
        } else {
          message.reactions.push({ user, reaction });
        }

        await message.save();
        io.to(message.room).emit("message reacted", {
          messageId,
          reactions: message.reactions,
        });
      } catch (error) {
        socket.emit("message error", {
          error: "Failed to add reaction",
          details: error.message,
        });
      }
    });

    // Handle sync request
    socket.on(
      "sync request",
      async ({ roomName, videoId, position, timestamp }) => {
        try {
          const room = await Room.findOne({ name: roomName });
          if (!room) return;

          const playlist = await Playlist.findOne({
            $or: [{ room: roomName }, { roomId: room._id }],
          });
          if (!playlist || !playlist.currentSong) return;

          // Calculate server-side timestamp for better accuracy
          const serverTimestamp = Date.now();
          const serverLatency = serverTimestamp - timestamp;

          // Update the server's record of the current position with latency compensation
          playlist.currentSong.position = position + serverLatency / 1000; // Convert latency to seconds
          await playlist.save();

          // Broadcast sync request to all clients in the room except sender
          socket.to(roomName).emit("sync request", {
            roomName,
            videoId,
            position: playlist.currentSong.position,
            timestamp: serverTimestamp,
            serverLatency,
          });
        } catch (error) {
          console.error("Error handling sync request:", error);
        }
      }
    );

    // Handle sync response
    socket.on(
      "sync response",
      ({ roomName, videoId, position, timestamp, latency }) => {
        try {
          const serverTimestamp = Date.now();
          const roundTripTime = serverTimestamp - timestamp;

          // Calculate the most accurate position by accounting for network delays
          const adjustedPosition = position + (roundTripTime + latency) / 2000; // Convert to seconds

          // Broadcast the sync response to all clients in the room
          io.to(roomName).emit("sync response", {
            roomName,
            videoId,
            position: adjustedPosition,
            timestamp: serverTimestamp,
            latency: roundTripTime,
          });
        } catch (error) {
          console.error("Error handling sync response:", error);
        }
      }
    );

    // Play music event handler
    socket.on("play music", async ({ roomName, videoId }) => {
      try {
        const room = await Room.findOne({ name: roomName });
        if (!room) return;

        const playlist = await Playlist.findOne({
          $or: [{ room: roomName }, { roomId: room._id }],
        });
        if (!playlist) return;

        const currentTime = Date.now();
        const serverStartTime = currentTime;

        playlist.currentSong = {
          videoId,
          isPlaying: true,
          position: 0,
          startedAt: serverStartTime,
          lastSyncTime: serverStartTime,
        };

        await playlist.save();

        // Broadcast with precise timing information
        io.to(roomName).emit("play music", {
          roomName,
          videoId,
          isPlaying: true,
          position: 0,
          timestamp: currentTime,
          serverStartTime,
        });

        const message = await Message.create({
          room: roomName,
          user: "System",
          text: "▶️ Playing music",
        });

        io.to(roomName).emit("chat message", message);
      } catch (error) {
        console.error("Error playing music:", error);
      }
    });

    // Set current video - Fixed this function to account for roomId requirement
    socket.on("set current video", async ({ roomName, videoId }) => {
      try {
        console.log(`Setting video ${videoId} for room ${roomName}`);

        // First find the room to get its ID
        const room = await Room.findOne({ name: roomName });
        if (!room) {
          console.error(`Room not found: ${roomName}`);
          return;
        }

        // Find or create playlist for the room - try both room and roomId fields
        let playlist = await Playlist.findOne({
          $or: [{ room: roomName }, { roomId: room._id }],
        });

        if (!playlist) {
          // Create a new playlist with both room name and roomId
          playlist = new Playlist({
            room: roomName,
            roomId: room._id, // Add the roomId that's required by the schema
            songs: [],
            currentVideoId: videoId,
          });
        } else {
          // Update the existing playlist
          playlist.currentVideoId = videoId;

          // Ensure roomId is set if it wasn't before
          if (!playlist.roomId) {
            playlist.roomId = room._id;
          }
        }

        await playlist.save();

        // Emit to ALL clients in the specified room
        io.to(roomName).emit("current video changed", {
          videoId,
          roomName,
          timestamp: new Date(),
        });

        console.log(
          `Emitted current_video_changed to room ${roomName} with video ${videoId}`
        );

        // Add a system message to indicate video change
        const message = await Message.create({
          room: roomName,
          user: "System",
          text: `🎬 Video changed`,
        });

        io.to(roomName).emit("chat message", message);
      } catch (error) {
        console.error("Error setting current video:", error);
      }
    });

    // Pause music event handler
    socket.on("pause music", async ({ roomName, videoId }) => {
      try {
        const room = await Room.findOne({ name: roomName });
        if (!room) return;

        const playlist = await Playlist.findOne({
          $or: [{ room: roomName }, { roomId: room._id }],
        });
        if (!playlist) return;

        if (playlist.currentSong) {
          playlist.currentSong.isPlaying = false;
          await playlist.save();

          // It seems 'position' is undefined in your original code
          // You might need to get the current position from the client
          // or track it on the server
          const position = playlist.currentSong.position || 0;

          io.to(roomName).emit("pause music", {
            roomName,
            videoId,
            isPlaying: false,
            position,
            timestamp: new Date(),
          });

          const message = await Message.create({
            room: roomName,
            user: "System",
            text: "⏸️ Music paused",
          });

          io.to(roomName).emit("chat message", message);
        }
      } catch (error) {
        console.error("Error pausing music:", error);
      }
    });

    // Skip music
    socket.on("skip music", async ({ roomName, direction }) => {
      try {
        const room = await Room.findOne({ name: roomName });
        if (!room) return;

        const playlist = await Playlist.findOne({
          $or: [{ room: roomName }, { roomId: room._id }],
        });
        if (!playlist || !playlist.songs || playlist.songs.length === 0) return;

        const currentIndex = playlist.songs.findIndex(
          (song) => song.videoId === playlist.currentSong?.videoId
        );

        let nextSong;
        if (
          direction === "forward" &&
          currentIndex < playlist.songs.length - 1
        ) {
          nextSong = playlist.songs[currentIndex + 1];
        } else if (direction === "backward" && currentIndex > 0) {
          nextSong = playlist.songs[currentIndex - 1];
        }

        if (nextSong) {
          playlist.currentSong = {
            videoId: nextSong.videoId,
            startedAt: new Date(),
            position: 0,
            isPlaying: true,
          };

          await playlist.save();

          // More detailed video change event
          io.to(roomName).emit("current video changed", {
            roomName,
            videoId: nextSong.videoId,
            title: nextSong.title,
            position: 0,
            isPlaying: true,
            timestamp: new Date(),
            direction,
          });

          const message = await Message.create({
            room: roomName,
            user: "System",
            text: `⏭️ ${direction === "forward" ? "Next" : "Previous"} song: ${
              nextSong.title
            }`,
          });

          io.to(roomName).emit("chat message", message);
        }
      } catch (error) {
        console.error("Error skipping music:", error);
      }
    });

    // Enhanced seek music handler with comprehensive logging
    socket.on("seek music", async ({ roomName, videoId, position }) => {
      try {
        console.log("🎯 Seek Music Event Received:", {
          roomName,
          videoId,
          position,
          timestamp: Date.now(),
          socketId: socket.id,
        });

        // Validate parameters with more strict checks
        if (!roomName || typeof roomName !== "string") {
          console.error("❌ Invalid room name:", roomName);
          return;
        }

        if (!videoId || typeof videoId !== "string") {
          console.error("❌ Invalid video ID:", videoId);
          return;
        }

        if (typeof position !== "number" || isNaN(position)) {
          console.error("❌ Invalid seek position:", position);
          return;
        }

        // Sanitize position to prevent extreme values
        const sanitizedPosition = Math.max(0, Math.min(position, 3600)); // Max 1 hour

        // Broadcast seek event with sanitized data
        const seekEvent = {
          roomName,
          videoId,
          position: sanitizedPosition,
          timestamp: Date.now(),
          socketId: socket.id,
        };

        // Broadcast to all clients in the room
        io.to(roomName).emit("seek music", seekEvent);

        console.log("✅ Seek Music Event Broadcasted:", seekEvent);

        // Optional: Create a system message for tracking
        try {
          const message = await Message.create({
            room: roomName,
            user: "System",
            text: `⏩ Seeked to ${Math.round(sanitizedPosition)} seconds`,
          });

          io.to(roomName).emit("chat message", message);
        } catch (messageError) {
          console.error("❌ Failed to create seek message:", messageError);
        }
      } catch (error) {
        console.error("❌ Critical Error in Seek Music Handler:", error);
      }
    });

    // Add admin
    socket.on("add admin", async ({ roomName, username }) => {
      try {
        const room = await Room.findOne({ name: roomName });
        if (!room) return;

        if (!room.admins.includes(username)) {
          room.admins.push(username);
          await room.save();
          io.to(roomName).emit("admin added", { username });
        }
      } catch (error) {
        console.error("Error adding admin:", error);
      }
    });

    // Add DJ
    socket.on("add dj", async ({ roomName, username }) => {
      try {
        const room = await Room.findOne({ name: roomName });
        if (!room) return;

        if (!room.djs.includes(username)) {
          room.djs.push(username);
          await room.save();
          io.to(roomName).emit("dj added", { username });
        }
      } catch (error) {
        console.error("Error adding DJ:", error);
      }
    });

    // Playlist Management Socket Handlers

    // Add song to playlist
    socket.on("add to playlist", async ({ roomName, song }) => {
      try {
        console.log("🎵 Adding song to playlist:", song.title);

        // Broadcast to other clients in the room (excluding sender)
        socket.broadcast.to(roomName).emit("add to playlist", {
          roomName,
          song,
        });

        // Optionally save to database
        const room = await Room.findOne({ name: roomName });
        if (room) {
          let playlist = await Playlist.findOne({
            $or: [{ room: roomName }, { roomId: room._id }],
          });

          if (!playlist) {
            playlist = new Playlist({
              room: roomName,
              roomId: room._id.toString(),
              songs: [],
            });
          }

          playlist.songs.push({
            videoId: song.videoId,
            title: song.title,
            thumbnail: song.thumbnail,
            addedBy: socket.id, // You might want to pass username instead
            addedAt: new Date(),
          });

          await playlist.save();
        }
      } catch (error) {
        console.error("Error adding song to playlist:", error);
      }
    });

    // Remove song from playlist
    socket.on("remove from playlist", async ({ roomName, songId }) => {
      try {
        console.log("🗑️ Removing song from playlist:", songId);

        // Broadcast to other clients in the room (excluding sender)
        socket.broadcast.to(roomName).emit("remove from playlist", {
          roomName,
          songId,
        });
      } catch (error) {
        console.error("Error removing song from playlist:", error);
      }
    });

    // Reorder playlist
    socket.on("reorder playlist", async ({ roomName, playlist }) => {
      try {
        console.log("🔄 Reordering playlist for room:", roomName);

        // Broadcast to other clients in the room (excluding sender)
        socket.broadcast.to(roomName).emit("reorder playlist", {
          roomName,
          playlist,
        });
      } catch (error) {
        console.error("Error reordering playlist:", error);
      }
    });

    // Disconnect
    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });
};
