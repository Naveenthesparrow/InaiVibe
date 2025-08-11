import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  X,
  Plus,
  Trash2,
  GripVertical,
  Music,
  PlayCircle,
  Clock,
  Play,
  Pause,
} from "lucide-react";

const API_KEY = import.meta.env.VITE_YOUTUBE_V3_KEY;

function Playlist({
  socket,
  roomName,
  onVideoSelect,
  onPlaylistReady,
  currentVideoId,
}) {
  // States for search functionality
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // States for playlist
  const [playlist, setPlaylist] = useState([]);
  const [draggedItem, setDraggedItem] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [currentPlayingId, setCurrentPlayingId] = useState(""); // Track current playing song

  // Refs
  const searchTimeoutRef = useRef(null);
  const searchInputRef = useRef(null);
  const playNextSongRef = useRef(null);

  // Play next song in playlist
  const playNextSong = useCallback(() => {
    console.log("playNextSong called!", {
      currentPlayingId,
      playlistLength: playlist.length,
      playlist: playlist.map((song) => ({
        title: song.title,
        videoId: song.videoId,
      })),
    });

    const currentIndex = playlist.findIndex(
      (song) => song.videoId === currentPlayingId
    );
    const nextIndex = currentIndex + 1;

    console.log("Current index:", currentIndex, "Next index:", nextIndex);

    if (nextIndex < playlist.length) {
      const nextSong = playlist[nextIndex];
      console.log("Playing next song:", nextSong.title);
      setCurrentPlayingId(nextSong.videoId);
      onVideoSelect(nextSong.videoId);

      // Notify other users
      if (socket && roomName) {
        socket.emit("videoChange", {
          roomName,
          videoId: nextSong.videoId,
          title: nextSong.title,
        });
      }
    } else {
      console.log(
        "No more songs in playlist, current index:",
        currentIndex,
        "playlist length:",
        playlist.length
      );
      setCurrentPlayingId("");
    }
  }, [playlist, currentPlayingId, onVideoSelect, socket, roomName]);

  // Update ref whenever playNextSong changes
  useEffect(() => {
    playNextSongRef.current = playNextSong;
  }, [playNextSong]);

  // Stable wrapper function that never changes
  const stablePlayNextSong = useCallback(() => {
    if (playNextSongRef.current) {
      playNextSongRef.current();
    }
  }, []);

  // Sync currentPlayingId with external currentVideoId
  useEffect(() => {
    if (currentVideoId && currentVideoId !== currentPlayingId) {
      console.log(
        "Syncing currentPlayingId from external source:",
        currentVideoId
      );
      setCurrentPlayingId(currentVideoId);
    }
  }, [currentVideoId, currentPlayingId]);

  // Expose playNextSong function to parent component - only call once
  useEffect(() => {
    if (onPlaylistReady) {
      console.log("Exposing stable playNextSong function to parent");
      onPlaylistReady({ playNextSong: stablePlayNextSong });
    }
  }, [onPlaylistReady, stablePlayNextSong]); // stablePlayNextSong never changes

  // Search for songs
  const searchSongs = async (query) => {
    if (!query.trim() || query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);

    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
          query + " music"
        )}&type=video&maxResults=8&videoCategoryId=10&key=${API_KEY}`
      );
      const data = await response.json();

      if (data.items) {
        const songs = data.items.map((item) => ({
          videoId: item.id.videoId,
          title: item.snippet.title,
          channelTitle: item.snippet.channelTitle,
          thumbnail: item.snippet.thumbnails.medium.url,
          duration: "Unknown", // Would need additional API call for duration
        }));
        setSearchResults(songs);
      }
    } catch (error) {
      console.error("Error searching songs:", error);
    }

    setSearchLoading(false);
  };

  // Handle search input with debounce
  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchQuery(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      searchSongs(value);
    }, 300);
  };

  // Add song to playlist
  const addToPlaylist = (song) => {
    // Check if song already exists in playlist by videoId
    const songExists = playlist.some(
      (existingSong) => existingSong.videoId === song.videoId
    );
    if (songExists) {
      console.log("Song already exists in playlist:", song.title);
      return;
    }

    // Generate a more unique ID using videoId + timestamp + random
    const uniqueId = `${song.videoId}-${Date.now()}-${Math.floor(
      Math.random() * 10000
    )}`;

    const newSong = {
      ...song,
      id: uniqueId,
      addedAt: new Date().toLocaleTimeString(),
    };

    // Auto-play first song when playlist was empty BEFORE updating state
    const isFirstSong = playlist.length === 0;
    const hasNoCurrentSong = !currentPlayingId;
    const shouldAutoPlay = isFirstSong || hasNoCurrentSong;

    console.log("Adding to playlist:", {
      songTitle: song.title,
      isFirstSong,
      hasNoCurrentSong,
      shouldAutoPlay,
      currentPlaylistLength: playlist.length,
      currentPlayingId,
    });

    const updatedPlaylist = [...playlist, newSong];
    setPlaylist(updatedPlaylist);

    // Socket event to sync playlist across users
    if (socket && roomName) {
      socket.emit("add to playlist", {
        roomName,
        song: newSong,
      });
    }

    // Auto-play logic - only for locally added songs
    if (shouldAutoPlay && onVideoSelect) {
      console.log("AUTO-PLAYING:", newSong.title, {
        shouldAutoPlay,
        isFirstSong,
        hasNoCurrentSong,
        currentPlayingId,
        onVideoSelectExists: !!onVideoSelect,
      });

      setCurrentPlayingId(newSong.videoId);

      // Use immediate execution for auto-play
      onVideoSelect(newSong.videoId);

      // Also emit to socket so other users see the video change
      if (socket && roomName) {
        socket.emit("videoChange", {
          roomName,
          videoId: newSong.videoId,
          title: newSong.title,
        });
      }
    } else {
      console.log("AUTO-PLAY SKIPPED:", {
        shouldAutoPlay,
        isFirstSong,
        hasNoCurrentSong,
        currentPlayingId,
        onVideoSelectExists: !!onVideoSelect,
        reason: !shouldAutoPlay
          ? "shouldAutoPlay is false"
          : "onVideoSelect not available",
      });
    }

    console.log("Added to playlist:", song.title);
  };

  // Remove song from playlist
  const removeFromPlaylist = (songId) => {
    const updatedPlaylist = playlist.filter((song) => song.id !== songId);
    setPlaylist(updatedPlaylist);

    if (socket && roomName) {
      socket.emit("remove from playlist", {
        roomName,
        songId,
      });
    }
  };

  // Handle drag and drop for reordering
  const handleDragStart = (e, index, song) => {
    setDraggedItem({ index, song });
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();

    if (draggedItem && draggedItem.index !== dropIndex) {
      const newPlaylist = [...playlist];
      const draggedSong = newPlaylist.splice(draggedItem.index, 1)[0];
      newPlaylist.splice(dropIndex, 0, draggedSong);

      setPlaylist(newPlaylist);

      if (socket && roomName) {
        socket.emit("reorder playlist", {
          roomName,
          playlist: newPlaylist,
        });
      }
    }

    setDraggedItem(null);
    setDragOverIndex(null);
  };

  // Play song from playlist
  // Play song from playlist
  const playSong = (song) => {
    setCurrentPlayingId(song.videoId);
    onVideoSelect(song.videoId);

    // Notify other users through socket
    if (socket && roomName) {
      socket.emit("videoChange", {
        roomName,
        videoId: song.videoId,
        title: song.title,
      });
    }
  };

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    const handlePlaylistAdd = (data) => {
      if (data.roomName === roomName) {
        console.log(
          "Received playlist add from socket (other user):",
          data.song.title
        );
        const updatedPlaylist = [...playlist, data.song];
        setPlaylist(updatedPlaylist);

        // Auto-play if no current song and this is the first song
        if (!currentPlayingId && updatedPlaylist.length === 1) {
          console.log("Auto-playing from socket event:", data.song.title);
          setCurrentPlayingId(data.song.videoId);
          onVideoSelect(data.song.videoId);
        }
      }
    };

    const handlePlaylistRemove = (data) => {
      if (data.roomName === roomName) {
        const updatedPlaylist = playlist.filter(
          (song) => song.id !== data.songId
        );
        setPlaylist(updatedPlaylist);
      }
    };

    const handlePlaylistReorder = (data) => {
      if (data.roomName === roomName) {
        setPlaylist(data.playlist);
      }
    };

    // Listen for video changes from other components
    const handleVideoChange = (data) => {
      if (data.videoId) {
        setCurrentPlayingId(data.videoId);
      }
    };

    socket.on("add to playlist", handlePlaylistAdd);
    socket.on("remove from playlist", handlePlaylistRemove);
    socket.on("reorder playlist", handlePlaylistReorder);
    socket.on("videoChange", handleVideoChange);
    socket.on("video changed", handleVideoChange);

    return () => {
      socket.off("add to playlist", handlePlaylistAdd);
      socket.off("remove from playlist", handlePlaylistRemove);
      socket.off("reorder playlist", handlePlaylistReorder);
      socket.off("videoChange", handleVideoChange);
      socket.off("video changed", handleVideoChange);
    };
  }, [socket, roomName, playlist, currentPlayingId, onVideoSelect]);

  return (
    <div className="w-full bg-[#F6F7F9] rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-white text-black p-4 sm:p-6 border-b border-gray-200">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-black rounded-full p-2">
              <Music className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold">Music Queue</h2>
              <p className="text-gray-600 text-sm">
                {playlist.length} song{playlist.length !== 1 ? "s" : ""} queued
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="bg-black hover:bg-gray-800 text-white rounded-full p-3 transition-colors self-start sm:self-auto"
            aria-label="Toggle search"
          >
            {showSearch ? (
              <X className="w-5 h-5" />
            ) : (
              <Plus className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      {/* Search Box */}
      {showSearch && (
        <div className="p-6 bg-white border-b border-gray-200">
          <div className="space-y-4">
            <div className="relative">
              <div className="flex items-center gap-3 bg-gray-50 rounded-3xl p-3 border border-gray-200 focus-within:border-gray-400 transition-colors">
                <Search className="w-5 h-5 text-gray-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search for songs, artists, or albums..."
                  value={searchQuery}
                  onChange={handleSearchChange}
                  className="flex-1 bg-transparent outline-none text-gray-700 placeholder-gray-400"
                  autoFocus
                />
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      setSearchResults([]);
                    }}
                    className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Search Results */}
            {searchLoading && (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div>
                <p className="text-sm text-gray-500 mt-3">
                  Searching for music...
                </p>
              </div>
            )}

            {searchResults.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="p-3 bg-gray-50 border-b border-gray-200">
                  <p className="text-sm font-semibold text-gray-700">
                    🔍 Search Results
                  </p>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {searchResults.map((song, index) => (
                    <div
                      key={`${song.videoId}-${index}`}
                      className="flex items-center gap-4 p-4 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors group cursor-pointer"
                      onClick={() => addToPlaylist(song)}
                      title="Click to add to playlist"
                    >
                      <img
                        src={song.thumbnail}
                        alt={song.title}
                        className="w-16 h-12 rounded-2xl object-cover flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold text-gray-900 truncate hover:text-black transition-colors">
                          {song.title}
                        </h4>
                        <p className="text-sm text-gray-500 truncate">
                          {song.channelTitle}
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation(); // Prevent double-click when clicking the button
                          addToPlaylist(song);
                        }}
                        className="bg-black text-white rounded-full px-3 py-2 hover:bg-gray-800 transition-colors opacity-0 group-hover:opacity-100 flex items-center gap-1 font-medium text-sm"
                        title="Add to playlist"
                      >
                        <Plus className="w-4 h-4" /> Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {searchQuery && !searchLoading && searchResults.length === 0 && (
              <div className="text-center py-12">
                <Music className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500 mb-1">No songs found</p>
                <p className="text-sm text-gray-400">
                  Try different keywords or artist names
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Playlist Container */}
      <div className="p-6">
        {playlist.length === 0 ? (
          <div className="text-center py-16">
            <div className="bg-gray-50 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
              <Music className="w-10 h-10 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Your playlist is empty
            </h3>
            <p className="text-gray-500 mb-4">
              Add some songs to get the party started!
            </p>
            <button
              onClick={() => setShowSearch(true)}
              className="bg-black text-white rounded-full px-6 py-3 hover:bg-gray-800 transition-colors font-medium flex items-center gap-2 mx-auto"
            >
              <Plus className="w-4 h-4" /> Add Songs
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Up Next</h3>
              <p className="text-sm text-gray-500">{playlist.length} songs</p>
            </div>

            <div className="space-y-2">
              {playlist.map((song, index) => (
                <div
                  key={song.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index, song)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={() => {
                    setDraggedItem(null);
                    setDragOverIndex(null);
                  }}
                  className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all cursor-move hover:bg-white group bg-white ${
                    dragOverIndex === index
                      ? "border-gray-400 bg-gray-50"
                      : "border-gray-200"
                  } ${
                    currentPlayingId === song.videoId
                      ? "ring-2 ring-black border-black bg-gray-50"
                      : ""
                  }`}
                >
                  {/* Drag Handle */}
                  <div className="flex items-center gap-2">
                    <GripVertical className="w-4 h-4 text-gray-400 group-hover:text-gray-600" />
                    <span className="text-sm font-medium text-gray-500 w-6 text-center">
                      {index + 1}
                    </span>
                  </div>

                  {/* Song Thumbnail */}
                  <div className="relative">
                    <img
                      src={song.thumbnail}
                      alt={song.title}
                      className="w-16 h-12 rounded-2xl object-cover"
                    />
                    {currentPlayingId === song.videoId && (
                      <div className="absolute inset-0 bg-black bg-opacity-40 rounded-2xl flex items-center justify-center">
                        <PlayCircle className="w-6 h-6 text-white" />
                      </div>
                    )}
                  </div>

                  {/* Song Info */}
                  <div className="flex-1 min-w-0">
                    <h4
                      className={`text-sm font-semibold truncate cursor-pointer transition-colors ${
                        currentPlayingId === song.videoId
                          ? "text-green-600"
                          : "text-gray-900 hover:text-black"
                      }`}
                      onClick={() => playSong(song)}
                      title={song.title}
                    >
                      {song.title}
                    </h4>
                    <p className="text-sm text-gray-500 truncate">
                      {song.channelTitle}
                    </p>
                    <div className="flex items-center gap-4 mt-1">
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Added {song.addedAt}
                      </span>
                    </div>
                  </div>

                  {/* Action Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFromPlaylist(song.id);
                    }}
                    className="bg-black text-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-all hover:bg-gray-800"
                    title="Remove from playlist"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Playlist;
