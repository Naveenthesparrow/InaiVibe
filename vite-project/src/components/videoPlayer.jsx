import React, { useEffect, useRef, useState } from "react";
import {
  Pause,
  Play,
  Rewind,
  FastForward,
  SkipBack,
  SkipForward,
} from "lucide-react";

function YouTubePlayer({ videoId, socket, roomName, onVideoEnd }) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [videoTitle, setVideoTitle] = useState("");
  const iframeRef = useRef(null);
  const playerReadyRef = useRef(false);
  const [lastSeekPosition, setLastSeekPosition] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const videoEndCheckRef = useRef(null);

  // Helper function to send commands to YouTube iframe
  const sendCommand = (command, args = "") => {
    if (iframeRef.current) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({
          event: "command",
          func: command,
          args: [args],
        }),
        "*"
      );
    }
  };

  // Fixed seek function - gets current time first, then seeks to absolute position
  const seekVideo = (offsetSeconds) => {
    return new Promise((resolve, reject) => {
      if (!iframeRef.current) {
        console.error("Iframe ref is not available");
        reject(new Error("Iframe not ready"));
        return;
      }

      // Step 1: Get current time first
      const getCurrentTimeAndSeek = () => {
        return new Promise((timeResolve, timeReject) => {
          let currentTime = 0;
          let timeoutId;

          // Message handler to get current time
          const timeHandler = (event) => {
            try {
              const data = JSON.parse(event.data);

              if (
                data.event === "infoDelivery" &&
                data.info &&
                typeof data.info.currentTime === "number"
              ) {
                currentTime = data.info.currentTime;

                // Remove listener and clear timeout
                window.removeEventListener("message", timeHandler);
                if (timeoutId) clearTimeout(timeoutId);

                // Calculate new absolute position
                const newPosition = Math.max(0, currentTime + offsetSeconds);

                // Step 2: Seek to the calculated absolute position
                seekToAbsolutePosition(newPosition)
                  .then(timeResolve)
                  .catch(timeReject);
              }
            } catch (error) {
              console.error("Error parsing time message:", error);
            }
          };

          // Add listener for current time
          window.addEventListener("message", timeHandler);

          // Request current time from YouTube player
          try {
            iframeRef.current.contentWindow.postMessage(
              JSON.stringify({
                event: "command",
                func: "getCurrentTime",
                args: [],
              }),
              "*"
            );

            // Also request player info as backup
            iframeRef.current.contentWindow.postMessage(
              JSON.stringify({
                event: "command",
                func: "getVideoData",
                args: [],
              }),
              "*"
            );
          } catch (error) {
            console.error("Failed to request current time:", error);
            window.removeEventListener("message", timeHandler);
            timeReject(error);
            return;
          }

          // Timeout if no response
          timeoutId = setTimeout(() => {
            window.removeEventListener("message", timeHandler);

            // Fallback: try to seek with estimated position
            const fallbackPosition = Math.max(
              0,
              lastSeekPosition + offsetSeconds
            );
            seekToAbsolutePosition(fallbackPosition)
              .then(timeResolve)
              .catch(timeReject);
          }, 1500);
        });
      };

      // Step 2: Seek to absolute position
      const seekToAbsolutePosition = (absolutePosition) => {
        return new Promise((seekResolve, seekReject) => {
          try {
            // Send seek command to YouTube player
            iframeRef.current.contentWindow.postMessage(
              JSON.stringify({
                event: "command",
                func: "seekTo",
                args: [absolutePosition, true], // true for allowSeekAhead
              }),
              "*"
            );

            // Update our tracking
            setLastSeekPosition(absolutePosition);

            // Synchronize across devices
            socket.emit("seek music", {
              roomName,
              videoId,
              position: absolutePosition, // Send absolute position
            });

            seekResolve(absolutePosition);
          } catch (error) {
            console.error("Failed to seek to absolute position:", error);
            seekReject(error);
          }
        });
      };

      // Execute the seek process
      getCurrentTimeAndSeek()
        .then((newPosition) => {
          resolve(newPosition);
        })
        .catch((error) => {
          console.error("Seek operation failed:", error);
          reject(error);
        });
    });
  };

  // Backup video end detection using timer
  const startVideoEndDetection = () => {
    // Clear any existing timer
    if (videoEndCheckRef.current) {
      clearInterval(videoEndCheckRef.current);
    }

    videoEndCheckRef.current = setInterval(() => {
      if (iframeRef.current) {
        // Request current time and duration
        try {
          iframeRef.current.contentWindow.postMessage(
            JSON.stringify({
              event: "command",
              func: "getCurrentTime",
              args: [],
            }),
            "*"
          );

          iframeRef.current.contentWindow.postMessage(
            JSON.stringify({
              event: "command",
              func: "getDuration",
              args: [],
            }),
            "*"
          );

          // Also request player state
          iframeRef.current.contentWindow.postMessage(
            JSON.stringify({
              event: "command",
              func: "getPlayerState",
              args: [],
            }),
            "*"
          );
        } catch (error) {
          console.error("Error requesting video status:", error);
        }
      }
    }, 1000); // Check every 1 second (more frequent)
  };

  // Stop video end detection timer
  const stopVideoEndDetection = () => {
    if (videoEndCheckRef.current) {
      clearInterval(videoEndCheckRef.current);
      videoEndCheckRef.current = null;
    }
  };

  // Cleanup on component unmount or video change
  useEffect(() => {
    return () => {
      stopVideoEndDetection();
    };
  }, [videoId]); // Restart detection when video changes

  // Forward button handler - skip 10 seconds ahead
  const skipForward = () => {
    seekVideo(10)
      .then((newPosition) => {})
      .catch((error) => {
        console.error("Forward seek failed:", error);
      });
  };

  // Backward button handler - skip 10 seconds back
  const skipBackward = () => {
    seekVideo(-10)
      .then((newPosition) => {})
      .catch((error) => {
        console.error("Backward seek failed:", error);
      });
  };

  // Synchronized play/pause toggle
  const togglePlayPause = () => {
    if (isPlaying) {
      // Emit pause event to synchronize across devices
      socket.emit("pause music", {
        roomName,
        videoId,
      });
    } else {
      // Emit play event to synchronize across devices
      socket.emit("play music", {
        roomName,
        videoId,
      });
    }
  };

  // Socket event handlers for synchronized playback
  useEffect(() => {
    // Play music event handler
    const handlePlayMusic = (data) => {
      if (data.roomName === roomName && data.videoId === videoId) {
        setIsPlaying(true);
        sendCommand("playVideo");
      }
    };

    // Pause music event handler
    const handlePauseMusic = (data) => {
      if (data.roomName === roomName && data.videoId === videoId) {
        setIsPlaying(false);
        sendCommand("pauseVideo");
      }
    };

    // Seek music event handler
    const handleSeekMusic = (data) => {
      if (data.roomName === roomName && data.videoId === videoId) {
        try {
          sendCommand("seekTo", data.position);
          // Update our position tracking
          setLastSeekPosition(data.position);
        } catch (seekError) {
          console.error("Failed to seek in client:", seekError);
        }
      }
    };

    // Add socket listeners
    socket.on("play music", handlePlayMusic);
    socket.on("pause music", handlePauseMusic);
    socket.on("seek music", handleSeekMusic);

    // Cleanup listeners
    return () => {
      socket.off("play music", handlePlayMusic);
      socket.off("pause music", handlePauseMusic);
      socket.off("seek music", handleSeekMusic);
    };
  }, [socket, roomName, videoId]);

  // Fetch video title and notify of video change
  useEffect(() => {
    if (videoId) {
      fetch(
        `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`
      )
        .then((res) => res.json())
        .then((data) => {
          setVideoTitle(data.title || "Unknown Video");

          // Notify other components (like Playlist) about video change
          if (socket && roomName) {
            socket.emit("videoChange", {
              roomName,
              videoId,
              title: data.title || "Unknown Video",
            });
          }
        })
        .catch((err) => console.error("Error fetching title:", err));
    }
  }, [videoId, socket, roomName]);

  // Debug message handler and video end detection
  useEffect(() => {
    const debugMessageHandler = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Also check for video end in different event format
        if (
          data.event === "video-progress" &&
          data.info &&
          data.info.currentTime &&
          data.info.duration
        ) {
          const { currentTime, duration } = data.info;
          // If we're within 1 second of the end, consider it ended
          if (duration - currentTime <= 1 && currentTime > 0) {
            if (onVideoEnd) {
              onVideoEnd();
            }
          }
        }

        // Check for command responses (getCurrentTime, getDuration, getPlayerState)
        if (data.event === "command") {
          if (data.func === "getCurrentTime" && typeof data.info === "number") {
            // Current time received
          }
          if (data.func === "getDuration" && typeof data.info === "number") {
            setVideoDuration(data.info);
          }
          if (data.func === "getPlayerState" && typeof data.info === "number") {
            if (data.info === 0) {
              if (onVideoEnd) {
                onVideoEnd();
              }
            }
          }
        }

        // Check for infoDelivery responses
        if (data.event === "infoDelivery" && data.info) {
          const { currentTime, duration, playerState } = data.info;

          // Check if player state indicates ended
          if (playerState === 0) {
            if (onVideoEnd) {
              onVideoEnd();
            }
          }

          // Also check if we're near the end based on time
          if (
            duration &&
            currentTime &&
            duration - currentTime <= 1 &&
            currentTime > 0
          ) {
            if (onVideoEnd) {
              onVideoEnd();
            }
          }
        }
      } catch (error) {
        // Unprocessable message - silently ignore
      }
    };

    // Add debug listener
    window.addEventListener("message", debugMessageHandler);

    // Cleanup
    return () => {
      window.removeEventListener("message", debugMessageHandler);
    };
  }, [onVideoEnd]);
  return (
    <div className="flex flex-col items-center gap-2 sm:gap-4 p-2 sm:p-4 w-full relative">
      <div className="w-[350px] md:w-[600px] lg:w-[700px] flex flex-col relative">
        <div className="w-full h-[250px] md:h-[350px] lg:h-[400px] rounded-2xl overflow-hidden relative">
          <iframe
            ref={iframeRef}
            id="youtube-player"
            width="100%"
            height="100%"
            src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&controls=0&rel=0&modestbranding=1&autoplay=1&mute=0&origin=${window.location.origin}&widget_referrer=${window.location.href}&iv_load_policy=3&disablekb=1&fs=1`}
            title="YouTube video player"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="rounded-2xl"
            onLoad={() => {
              playerReadyRef.current = true;

              // Send initial command to verify API is working
              setTimeout(() => {
                try {
                  // First enable state change events
                  iframeRef.current.contentWindow.postMessage(
                    JSON.stringify({
                      event: "listening",
                      id: "youtube-player",
                    }),
                    "*"
                  );

                  sendCommand("playVideo");

                  // Start video end detection backup timer
                  startVideoEndDetection();
                } catch (error) {
                  console.error("Failed to send initial commands", error);
                }
              }, 1000);
            }}
          ></iframe>
          {/* Overlay to prevent direct interactions */}
          <div
            className="absolute inset-0 z-10"
            style={{
              pointerEvents: "auto",
              cursor: "not-allowed",
            }}
            title="Video interactions are disabled"
          ></div>
        </div>
        {videoTitle && (
          <h2 className="text-xs sm:text-base md:text-lg font-semibold mt-1 sm:mt-2 truncate px-2 w-[350px] md:w-[600px] lg:w-[800px]">
            {videoTitle}
          </h2>
        )}

        {/* Controls */}
        <div className="w-[350px] md:w-[600px] lg:w-[700px] mx-auto py-2 sm:py-3 mt-2 sm:mt-4 bg-gray-50 rounded-2xl">
          <div className="flex items-center justify-center gap-1 sm:gap-4">
            <button
              className="p-1 sm:p-3 bg-black rounded-full text-white hover:bg-gray-800 transition-colors"
              aria-label="Rewind 10 seconds"
              onClick={skipBackward}
            >
              <Rewind className="w-3 h-3 sm:w-4 sm:h-4" />
            </button>

            <button
              className="p-2 sm:p-3 bg-black rounded-full text-white hover:bg-gray-800 transition-colors"
              aria-label={isPlaying ? "Pause" : "Play"}
              onClick={togglePlayPause}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 sm:w-5 sm:h-5" />
              ) : (
                <Play className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </button>

            <button
              className="p-1 sm:p-3 bg-black rounded-full text-white hover:bg-gray-800 transition-colors"
              aria-label="Forward 10 seconds"
              onClick={skipForward}
            >
              <FastForward className="w-3 h-3 sm:w-4 sm:h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default YouTubePlayer;
