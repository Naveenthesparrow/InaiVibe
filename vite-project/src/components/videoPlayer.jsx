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

  // Helper function to send commands to YouTube iframe
  const sendCommand = (command, args = "") => {
    console.log(`Sending command: ${command}, Args: ${args}`);
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
      console.log(
        `Attempting to seek ${offsetSeconds} seconds relative to current position`
      );

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
                console.log(`Current time retrieved: ${currentTime} seconds`);

                // Remove listener and clear timeout
                window.removeEventListener("message", timeHandler);
                if (timeoutId) clearTimeout(timeoutId);

                // Calculate new absolute position
                const newPosition = Math.max(0, currentTime + offsetSeconds);
                console.log(
                  `Seeking to absolute position: ${newPosition} seconds`
                );

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

            console.log("Requested current time from YouTube player");
          } catch (error) {
            console.error("Failed to request current time:", error);
            window.removeEventListener("message", timeHandler);
            timeReject(error);
            return;
          }

          // Timeout if no response
          timeoutId = setTimeout(() => {
            console.warn("Timeout getting current time, using fallback");
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
          console.log(`Seeking to absolute position: ${absolutePosition}`);

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

            console.log(
              `Successfully sent seek command to position: ${absolutePosition}`
            );
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
          console.log(
            `Seek completed successfully to position: ${newPosition}`
          );
          resolve(newPosition);
        })
        .catch((error) => {
          console.error("Seek operation failed:", error);
          reject(error);
        });
    });
  };

  // Forward button handler - skip 10 seconds ahead
  const skipForward = () => {
    console.log("Skip Forward button clicked - seeking +10 seconds");

    seekVideo(10)
      .then((newPosition) => {
        console.log(
          `Successfully seeked forward to position: ${newPosition} seconds`
        );
      })
      .catch((error) => {
        console.error("Forward seek failed:", error);
        // Show user-friendly error message
        console.warn("Unable to seek forward. Please try again.");
      });
  };

  // Backward button handler - skip 10 seconds back
  const skipBackward = () => {
    console.log("Skip Backward button clicked - seeking -10 seconds");

    seekVideo(-10)
      .then((newPosition) => {
        console.log(
          `Successfully seeked backward to position: ${newPosition} seconds`
        );
      })
      .catch((error) => {
        console.error("Backward seek failed:", error);
        // Show user-friendly error message
        console.warn("Unable to seek backward. Please try again.");
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
          console.log(
            `Received seek event - seeking to absolute position: ${data.position}`
          );
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

        console.log("🔍 YouTube Iframe Full Debug:", {
          rawEvent: event.data,
          parsedData: data,
          eventType: data.event,
          currentTime: data.info?.currentTime,
          fullInfo: data.info,
        });

        // Check for video end event
        if (data.event === "onStateChange" && data.info === 0) {
          // YouTube player state 0 means ended
          console.log("🏁 Video ended, triggering next song");
          if (onVideoEnd) {
            onVideoEnd();
          }
        }

        // Additional specific logging for different event types
        if (data.event === "infoDelivery") {
          console.group("YouTube Info Delivery");
          console.log("Current Time:", data.info?.currentTime);
          console.log("Duration:", data.info?.duration);
          console.log("Playback Rate:", data.info?.playbackRate);
          console.log("Volume:", data.info?.volume);
          console.groupEnd();
        }
      } catch (error) {
        console.log("🚨 Unprocessable message:", {
          originalData: event.data,
          error: error.message,
        });
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
            src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&controls=0&rel=0&modestbranding=1&autoplay=1&mute=0`}
            title="YouTube video player"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="rounded-2xl"
            onLoad={() => {
              console.log("YouTube iframe loaded");
              playerReadyRef.current = true;

              // Send initial command to verify API is working
              setTimeout(() => {
                try {
                  sendCommand("playVideo");
                  console.log("Sent initial playVideo command");
                } catch (error) {
                  console.error(
                    "Failed to send initial playVideo command",
                    error
                  );
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
