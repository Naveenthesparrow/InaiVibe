import React, { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";

const API_KEY = import.meta.env.VITE_YOUTUBE_V3_KEY;

function VideoSearch({ onVideoSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [popularSongs, setPopularSongs] = useState([]);

  const searchTimeoutRef = useRef(null);
  const suggestionTimeoutRef = useRef(null);
  const inputRef = useRef(null);
  const suggestionsRef = useRef(null);

  // Popular song suggestions to show when input is empty
  const defaultPopularQueries = [
    "Popular music 2024",
    "Trending songs",
    "Top hits",
    "Latest music",
    "Best songs",
    "Viral songs",
  ];

  // Fetch search suggestions as user types
  const fetchSuggestions = async (searchQuery) => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setLoadingSuggestions(true);

    try {
      // Using YouTube's Search API to get suggestions
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
          searchQuery
        )}&type=video&maxResults=8&key=${API_KEY}`
      );
      const data = await response.json();

      if (data.items) {
        // Extract unique song titles as suggestions
        const uniqueSuggestions = [];
        const seenTitles = new Set();

        data.items.forEach((item) => {
          const title = item.snippet.title;
          const cleanTitle = title
            .replace(/\(.*?\)/g, "")
            .replace(/\[.*?\]/g, "")
            .trim();

          if (
            !seenTitles.has(cleanTitle.toLowerCase()) &&
            cleanTitle.length > 0
          ) {
            seenTitles.add(cleanTitle.toLowerCase());
            uniqueSuggestions.push({
              text: cleanTitle,
              fullTitle: title,
              videoId: item.id.videoId,
              channelTitle: item.snippet.channelTitle,
              thumbnail: item.snippet.thumbnails.default.url,
            });
          }
        });

        setSuggestions(uniqueSuggestions.slice(0, 6));
        setShowSuggestions(true);
      }
    } catch (error) {
      console.error("Error fetching suggestions:", error);
      setSuggestions([]);
    }

    setLoadingSuggestions(false);
  };

  // Fetch popular songs on component mount
  useEffect(() => {
    const fetchPopularSongs = async () => {
      try {
        const response = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&q=popular%20songs%202024&type=video&maxResults=6&key=${API_KEY}`
        );
        const data = await response.json();

        if (data.items) {
          const popular = data.items.map((item) => ({
            text: item.snippet.title
              .replace(/\(.*?\)/g, "")
              .replace(/\[.*?\]/g, "")
              .trim(),
            fullTitle: item.snippet.title,
            videoId: item.id.videoId,
            channelTitle: item.snippet.channelTitle,
            thumbnail: item.snippet.thumbnails.default.url,
          }));
          setPopularSongs(popular);
        }
      } catch (error) {
        console.error("Error fetching popular songs:", error);
      }
    };

    fetchPopularSongs();
  }, []);

  // Show popular suggestions when input is focused but empty
  const handleInputFocus = () => {
    if (query.trim() === "" && popularSongs.length > 0) {
      setSuggestions(popularSongs);
      setShowSuggestions(true);
    } else if (suggestions.length > 0) {
      setShowSuggestions(true);
    }
  };
  // Handle input changes with debounced suggestion fetching
  const handleInputChange = (e) => {
    const value = e.target.value;
    setQuery(value);
    setSelectedSuggestionIndex(-1);

    // Clear existing timeout
    if (suggestionTimeoutRef.current) {
      clearTimeout(suggestionTimeoutRef.current);
    }

    // If input is empty, show popular songs
    if (value.trim() === "") {
      setSuggestions(popularSongs);
      setShowSuggestions(popularSongs.length > 0);
      return;
    }

    // Set new timeout for suggestions
    suggestionTimeoutRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 300); // 300ms delay
  };

  // Handle keyboard navigation for suggestions
  const handleKeyDown = (e) => {
    if (!showSuggestions || suggestions.length === 0) {
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedSuggestionIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedSuggestionIndex((prev) =>
          prev > 0 ? prev - 1 : suggestions.length - 1
        );
        break;
      case "Enter":
        e.preventDefault();
        if (selectedSuggestionIndex >= 0) {
          handleSuggestionClick(suggestions[selectedSuggestionIndex]);
        } else {
          handleSearch(e);
        }
        break;
      case "Escape":
        setShowSuggestions(false);
        setSelectedSuggestionIndex(-1);
        break;
    }
  };

  // Handle suggestion selection
  const handleSuggestionClick = (suggestion) => {
    setQuery(suggestion.text);
    setShowSuggestions(false);
    setSuggestions([]);
    setSelectedSuggestionIndex(-1);

    // Optionally, immediately search for the selected suggestion
    performSearch(suggestion.text);
  };

  // Perform the actual search
  const performSearch = async (searchQuery) => {
    const queryToUse = searchQuery || query;
    if (!queryToUse.trim()) return;

    setLoading(true);
    setShowSuggestions(false);

    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
          queryToUse
        )}&type=video&maxResults=5&key=${API_KEY}`
      );
      const data = await response.json();
      setResults(data.items || []);
    } catch (error) {
      console.error("Error fetching YouTube videos:", error);
    }

    setLoading(false);
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    performSearch();
  };

  // Handle clicks outside suggestions to close them
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target) &&
        inputRef.current &&
        !inputRef.current.contains(event.target)
      ) {
        setShowSuggestions(false);
        setSelectedSuggestionIndex(-1);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      if (suggestionTimeoutRef.current) {
        clearTimeout(suggestionTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="w-[450px] md:w-[350px] lg:w-[350px] bg-[#F6F7F9] rounded-2xl p-2 sm:p-4 relative">
      {/* Search Box */}
      <form
        onSubmit={handleSearch}
        className="flex items-center border border-gray-300 rounded-3xl shadow-sm overflow-hidden relative"
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="Search YouTube videos..."
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleInputFocus}
          className="w-full p-2 text-sm sm:text-base outline-none"
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSuggestions([]);
              setShowSuggestions(false);
              setResults([]);
            }}
            className="px-2 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <button
          type="submit"
          className="bg-black text-white rounded-full px-2 py-2 sm:px-3 sm:py-3 hover:bg-gray-800 transition-colors flex items-center justify-center"
          disabled={loading}
        >
          <Search className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
      </form>

      {/* Search Suggestions Dropdown */}
      {showSuggestions && (suggestions.length > 0 || loadingSuggestions) && (
        <div
          ref={suggestionsRef}
          className="absolute z-50 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-64 overflow-y-auto"
        >
          {loadingSuggestions ? (
            <div className="p-3 text-center text-gray-500 text-sm">
              Loading suggestions...
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
                <p className="text-xs font-medium text-gray-600">
                  {query.trim() === "" ? "🔥 Popular Songs" : "💡 Suggestions"}
                </p>
              </div>
              <ul>
                {suggestions.map((suggestion, index) => (
                  <li
                    key={`${suggestion.videoId}-${index}`}
                    className={`px-3 py-2 cursor-pointer transition-colors border-b border-gray-100 last:border-b-0 flex items-center gap-3 ${
                      index === selectedSuggestionIndex
                        ? "bg-blue-50 text-blue-700"
                        : "hover:bg-gray-50"
                    }`}
                    onClick={() => handleSuggestionClick(suggestion)}
                    onMouseEnter={() => setSelectedSuggestionIndex(index)}
                  >
                    <img
                      src={suggestion.thumbnail}
                      alt={suggestion.text}
                      className="w-8 h-6 rounded object-cover flex-shrink-0"
                    />
                    <div className="flex-1 overflow-hidden">
                      <p className="text-sm font-medium truncate">
                        {suggestion.text}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {suggestion.channelTitle}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {/* Loading Indicator */}
      {loading && (
        <p className="text-center text-gray-500 mt-2">Searching...</p>
      )}

      {/* Search Results */}
      <ul className="mt-4 sm:mt-6 space-y-2 max-h-[300px] overflow-y-auto">
        {results.map((video) => (
          <li
            key={video.id.videoId}
            className="flex items-center gap-2 sm:gap-3 px-2 py-1 border-b cursor-pointer bg-white rounded-2xl hover:bg-gray-100 transition w-full"
            onClick={() => onVideoSelect(video.id.videoId)}
          >
            <img
              src={video.snippet.thumbnails.default.url}
              alt={video.snippet.title}
              className="w-12 h-8 sm:w-16 sm:h-10 rounded-md object-cover"
            />
            <div className="overflow-hidden">
              <h3 className="text-xs sm:text-sm font-semibold truncate w-[250px]">
                {video.snippet.title}
              </h3>
              <p className="text-xs text-gray-500 truncate w-[250px]">
                {video.snippet.channelTitle}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default VideoSearch;
