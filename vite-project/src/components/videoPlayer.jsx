import React, { useEffect, useRef, useState } from "react";
import {
  Pause,
  Rewind,
  FastForward,
  SkipBack,
  SkipForward,
} from "lucide-react";

function YouTubePlayer({ videoId, socket, roomName }) {
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

  // Simplified seek function
  const seekVideo = (seconds) => {
    return new Promise((resolve, reject) => {
      console.log(`Attempting to seek ${seconds} seconds`);

      if (!iframeRef.current) {
        console.error("Iframe ref is not available");
        reject(new Error("Iframe not ready"));
        return;
      }

      // Determine the actual seek amount (always 10 seconds)
      const seekAmount = seconds > 0 ? 10 : -10;

      // Direct seek method
      const performDirectSeek = () => {
        return new Promise((seekResolve, seekReject) => {
          // Unique identifier for this seek operation
          const seekId = `seek_${Date.now()}`;

          // Create a message handler specific to this seek
          const messageHandler = (event) => {
            try {
              const data = JSON.parse(event.data);

              // Check for current time info
              if (
                data.event === "infoDelivery" &&
                data.info &&
                typeof data.info.currentTime === "number"
              ) {
                const currentTime = data.info.currentTime;
                const newTime = Math.max(0, currentTime + seekAmount);

                console.log(
                  `Current time: ${currentTime}, New time: ${newTime}`
                );

                // Remove listener
                window.removeEventListener("message", messageHandler);

                seekResolve(newTime);
              }
            } catch (error) {
              console.error("Error in seek message handler:", error);
            }
          };

          // Add message listener for current time
          window.addEventListener("message", messageHandler);

          // Send seek command directly
          try {
            // Multiple seek attempts
            const seekCommands = [
              {
                event: "command",
                func: "seekTo",
                args: [seekAmount, true], // true for allowSeekAhead
              },
              {
                event: "command",
                func: "seekTo",
                args: [seekAmount],
              },
            ];

            seekCommands.forEach((command, index) => {
              setTimeout(() => {
                try {
                  iframeRef.current.contentWindow.postMessage(
                    JSON.stringify({
                      ...command,
                      seekId, // Add unique identifier
                    }),
                    "*"
                  );
                  console.log(`Seek attempt ${index + 1}:`, command);
                } catch (seekError) {
                  console.error(`Seek attempt ${index + 1} failed:`, seekError);
                }
              }, index * 100);
            });

            // Synchronize across devices
            socket.emit("seek music", {
              roomName,
              videoId,
              position: seekAmount,
            });

            // Timeout to handle cases where no response is received
            const timeoutId = setTimeout(() => {
              window.removeEventListener("message", messageHandler);
              seekReject(new Error("Seek operation timed out"));
            }, 2000);
          } catch (error) {
            console.error("Failed to send seek command:", error);
            window.removeEventListener("message", messageHandler);
            seekReject(error);
          }
        });
      };

      // Execute direct seek
      performDirectSeek()
        .then((newTime) => {
          resolve(newTime);
        })
        .catch((error) => {
          console.warn("Direct seek failed, attempting fallback");

          // Fallback seek method
          try {
            iframeRef.current.contentWindow.postMessage(
              JSON.stringify({
                event: "command",
                func: "seekTo",
                args: [seekAmount],
              }),
              "*"
            );

            socket.emit("seek music", {
              roomName,
              videoId,
              position: seekAmount,
            });

            resolve(seekAmount);
          } catch (fallbackError) {
            console.error("Fallback seek failed:", fallbackError);
            reject(fallbackError);
          }
        });
    });
  };

  // Forward button handler
  const skipForward = () => {
    console.log("Skip Forward button clicked");

    // Safely handle timer
    try {
      console.timeEnd("Forward Seek Duration");
    } catch (e) {
      // Ignore if timer doesn't exist
    }
    console.time("Forward Seek Duration");

    seekVideo(10)
      .then((time) => {
        console.log(`Successfully forwarded to ${time} seconds`);
        console.timeEnd("Forward Seek Duration");
      })
      .catch((error) => {
        console.error("Forward seek failed:", error);
        console.timeEnd("Forward Seek Duration");

        // Absolute fallback
        try {
          if (iframeRef.current) {
            iframeRef.current.contentWindow.postMessage(
              JSON.stringify({
                event: "command",
                func: "seekTo",
                args: [10],
              }),
              "*"
            );

            socket.emit("seek music", {
              roomName,
              videoId,
              position: 10,
            });
          }
        } catch (finalError) {
          console.error("Absolute final forward seek failed", finalError);
          alert("Unable to seek forward. Please check your connection.");
        }
      });
  };

  // Backward button handler
  const skipBackward = () => {
    console.log("Skip Backward button clicked");

    // Safely handle timer
    try {
      console.timeEnd("Backward Seek Duration");
    } catch (e) {
      // Ignore if timer doesn't exist
    }
    console.time("Backward Seek Duration");

    seekVideo(-10)
      .then((time) => {
        console.log(`Successfully backed to ${time} seconds`);
        console.timeEnd("Backward Seek Duration");
      })
      .catch((error) => {
        console.error("Backward seek failed:", error);
        console.timeEnd("Backward Seek Duration");

        // Absolute fallback
        try {
          if (iframeRef.current) {
            iframeRef.current.contentWindow.postMessage(
              JSON.stringify({
                event: "command",
                func: "seekTo",
                args: [-10],
              }),
              "*"
            );

            socket.emit("seek music", {
              roomName,
              videoId,
              position: -10,
            });
          }
        } catch (finalError) {
          console.error("Absolute final backward seek failed", finalError);
          alert("Unable to seek backward. Please check your connection.");
        }
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

  // Fetch video title
  useEffect(() => {
    if (videoId) {
      fetch(
        `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`
      )
        .then((res) => res.json())
        .then((data) => setVideoTitle(data.title || "Unknown Video"))
        .catch((err) => console.error("Error fetching title:", err));
    }
  }, [videoId]);

  // Debug function to log postMessage events
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
  }, []);

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
                <Pause className="w-4 h-4 sm:w-5 sm:h-5" />
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
