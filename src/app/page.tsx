"use client";

import { useEffect, useRef, useState } from "react";
import AudioStream from "./component/AudioStream";

interface RealtimeEvent {
  type: string;
  event_id?: string;
  response?: {
    object: string;
    id: string;
    status: string;
    status_details?: any;
    output: Array<{
      id: string;
      object: string;
      type: string;
      status: string;
      role: string;
      content: Array<{
        type: string;
        transcript?: string;
        text?: string;
        audio_url?: string; // If audio is sent via URL
      }>;
    }>;
    usage?: any;
    metadata?: any;
  };
}

export default function RealTimePage() {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [aiMessages, setAiMessages] = useState<string[]>([]);
  const [userMessages, setUserMessages] = useState<string[]>([]);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(
    null
  );
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [aiTranscript, setAiTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Scroll refs for AI and User message panels
  const aiMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const userMessagesEndRef = useRef<HTMLDivElement | null>(null);

  // Initialize connection on component mount
  useEffect(() => {
    initRealTimeConnection();
    // Cleanup on unmount
    return () => {
      if (pcRef.current) {
        pcRef.current.close();
      }
      if (mediaRecorder) {
        mediaRecorder.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track AI speaking status based on audio playback
  useEffect(() => {
    const audioEl = audioElRef.current;
    if (audioEl) {
      const handlePlay = () => {
        setIsAISpeaking(true);
      };

      const handleEnded = () => {
        setIsAISpeaking(false);
      };

      audioEl.addEventListener("play", handlePlay);
      audioEl.addEventListener("ended", handleEnded);

      return () => {
        audioEl.removeEventListener("play", handlePlay);
        audioEl.removeEventListener("ended", handleEnded);
      };
    }
  }, [audioElRef.current]);

  // Scroll to latest AI message
  useEffect(() => {
    if (aiMessagesEndRef.current) {
      aiMessagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [aiMessages]);

  // Scroll to latest User message
  useEffect(() => {
    if (userMessagesEndRef.current) {
      userMessagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [userMessages]);

  async function initRealTimeConnection() {
    try {
      // 1. Get an ephemeral key from your server: /api/session (POST)
      const tokenResponse = await fetch("/api/session", {
        method: "POST",
      });
      if (!tokenResponse.ok) {
        throw new Error("Failed to fetch session token.");
      }
      const { client_secret } = await tokenResponse.json();
      const EPHEMERAL_KEY = client_secret.value;

      // 2. Create a new RTCPeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 3. Set up to play remote audio from the model
      audioElRef.current = document.createElement("audio");
      audioElRef.current.autoplay = true;

      const handleOnTrack = (event: any) => {
        console.log("Received remote audio track:", event);
        // Assuming the first stream is the audio stream
        setRemoteStream(event.streams[0]);
      };
      pc.ontrack = (e) => {
        console.log("Received remote audio track:", e);
        if (audioElRef.current) {
          handleOnTrack(e);
          audioElRef.current.srcObject = e.streams[0];
        }
      };

      // 4. Add local audio track (microphone input) in the browser
      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      pc.addTrack(localStream.getTracks()[0]);

      // 5. Create a data channel for sending and receiving events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      // Listen for messages from the server
      dc.addEventListener("message", (e) => {
        try {
          const realtimeEvent: RealtimeEvent = JSON.parse(e.data);
          handleRealtimeEvent(realtimeEvent);
        } catch (err) {
          console.error("Failed to parse message data:", e.data);
        }
      });

      // 6. Create SDP offer and set local description
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 7. Send the SDP offer to OpenAI’s Realtime API
      const baseUrl = "https://api.openai.com/v1/realtime";
      const model = "gpt-4o-realtime-preview-2024-12-17";
      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResponse.ok) {
        throw new Error("Failed to establish peer connection with AI.");
      }

      // 8. Receive and set the remote SDP answer
      const remoteAnswerSDP = await sdpResponse.text();
      await pc.setRemoteDescription({
        type: "answer",
        sdp: remoteAnswerSDP,
      });

      setIsInitialized(true);
      console.log("Real-time connection initialized!");
    } catch (error) {
      console.error("Error initializing real-time connection:", error);
      setError("Failed to initialize connection. Please try again.");
    }
  }

  // Handle incoming real-time events
  function handleRealtimeEvent(event: RealtimeEvent) {
    switch (event.type) {
      case "response.done":
        if (event.response && event.response.output) {
          event.response.output.forEach((item) => {
            if (item.type === "message" && item.content) {
              item.content.forEach((content) => {
                if (content.type === "audio") {
                  const transcript = content.transcript;
                  if (transcript !== undefined) {
                    setAiMessages((prev) => [...prev, transcript]);
                    setAiTranscript(transcript);
                  }
                  // The audio stream is handled via the ontrack event
                } else if (content.type === "text") {
                  const text = content.text;
                  if (text !== undefined) {
                    setAiMessages((prev) => [...prev, text]);
                    setAiTranscript(text);
                  }
                }
              });
            }
          });
          setIsProcessing(false);
        }
        break;
      // Handle other event types as needed
      case "response.error":
        setAiMessages((prev) => [...prev, "AI encountered an error."]);
        setIsProcessing(false);
        break;
      default:
        console.log("Unhandled event type:", event.type, event);
    }
  }

  // Start recording audio
  async function startRecording() {
    if (!pcRef.current) {
      console.error("PeerConnection not initialized.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      setMediaRecorder(recorder);
      setAudioChunks([]);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          setAudioChunks((prev) => [...prev, event.data]);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
        sendAudio(audioBlob);
      };

      recorder.start();
      setIsRecording(true);
      setIsProcessing(true);
      console.log("Recording started.");
    } catch (err) {
      console.error("Error starting recording:", err);
      setError("Failed to start recording.");
    }
  }

  // Stop recording audio
  function stopRecording() {
    if (mediaRecorder) {
      mediaRecorder.stop();
      setIsRecording(false);
      console.log("Recording stopped.");
    }
  }

  // Send audio data over the data channel
  function sendAudio(audioBlob: Blob) {
    if (!dcRef.current) {
      console.error("Data channel not initialized.");
      setIsProcessing(false);
      setError("Data channel not initialized.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result;
      if (arrayBuffer instanceof ArrayBuffer) {
        // Convert ArrayBuffer to Base64
        const base64Audio = arrayBufferToBase64(arrayBuffer);
        dcRef.current?.send(
          JSON.stringify({ type: "audio", data: base64Audio })
        );
        setUserMessages((prev) => [...prev, "You: Audio sent"]);
      }
    };
    reader.readAsArrayBuffer(audioBlob);
  }

  // Utility function to convert ArrayBuffer to Base64
  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  // Send text message over the data channel
  function sendTextMessage(text: string) {
    if (!dcRef.current) return;
    const message = {
      type: "message",
      data: { text },
    };
    dcRef.current.send(JSON.stringify(message));
    setUserMessages((prev) => [...prev, `You: ${text}`]);
    setIsProcessing(true);
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6 text-black">
      <div className="max-w-4xl mx-auto bg-white shadow-md rounded-lg p-6">
        <h1 className="text-2xl font-bold mb-4 text-center">
          EVNTS AI Tutor - Real-time Chat Interface
        </h1>

        {/* Chat Interface */}
        <div className="flex space-x-4">
          {/* AI Tutor Panel */}
          <div className="w-1/2 bg-blue-50 p-4 rounded-lg flex flex-col">
            <h2 className="text-xl font-semibold mb-2">AI Tutor</h2>
            <div className="flex-1 h-64 overflow-y-auto space-y-2">
              {aiMessages.map((msg, idx) => (
                <div key={idx} className="bg-blue-200 p-2 rounded">
                  {msg}
                </div>
              ))}
              {isProcessing && (
                <div className="flex items-center">
                  <svg
                    className="animate-spin h-5 w-5 text-blue-500 mr-2"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    ></path>
                  </svg>
                  <span>AI is processing...</span>
                </div>
              )}
              {isAISpeaking && (
                <div className="flex items-center space-x-2">
                  <svg
                    className="animate-pulse h-5 w-5 text-green-500"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M2 10a8 8 0 1116 0 8 8 0 01-16 0zm10-2a2 2 0 00-4 0v4a2 2 0 004 0V8z" />
                  </svg>
                  <span>AI is speaking...</span>
                </div>
              )}
              {/* Scroll to bottom */}
              <div ref={aiMessagesEndRef} />
            </div>
            {remoteStream && (
              <div className="mt-4">
                <AudioStream stream={remoteStream} />
              </div>
            )}
          </div>

          {/* Human User Panel */}
          <div className="w-1/2 bg-green-50 p-4 rounded-lg flex flex-col">
            <h2 className="text-xl font-semibold mb-2">Your Side</h2>
            <div className="flex-1 h-64 overflow-y-auto space-y-2">
              {userMessages.map((msg, idx) => (
                <div key={idx} className="bg-green-200 p-2 rounded">
                  {msg}
                </div>
              ))}
              {/* Scroll to bottom */}
              <div ref={userMessagesEndRef} />
            </div>
            <div className="mt-4 flex space-x-2">
              <button
                onClick={startRecording}
                disabled={isRecording || !isInitialized}
                className={`px-4 py-2 bg-red-500 text-white rounded ${
                  isRecording || !isInitialized
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:bg-red-600"
                }`}
              >
                {isRecording ? "Recording..." : "Start Recording"}
              </button>
              <button
                onClick={stopRecording}
                disabled={!isRecording}
                className={`px-4 py-2 bg-yellow-500 text-white rounded ${
                  !isRecording
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:bg-yellow-600"
                }`}
              >
                Stop Recording
              </button>
            </div>
          </div>
        </div>

        {/* Send Text Message */}
        <div className="mt-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.target as typeof e.target & {
                message: { value: string };
              };
              const message = form.message.value.trim();
              if (message) {
                sendTextMessage(message);
                form.message.value = "";
              }
            }}
            className="flex space-x-2"
          >
            <input
              type="text"
              name="message"
              placeholder="Type your message..."
              className="flex-1 px-4 py-2 border rounded"
              disabled={!isInitialized || isProcessing}
            />
            <button
              type="submit"
              disabled={!isInitialized || isProcessing}
              className={`px-4 py-2 bg-blue-500 text-white rounded ${
                !isInitialized || isProcessing
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:bg-blue-600"
              }`}
            >
              Send
            </button>
          </form>
        </div>

        {/* Status and Error Messages */}
        <div className="mt-4 text-center">
          {isInitialized ? (
            <span className="text-green-600 font-semibold">
              Connection Established
            </span>
          ) : (
            <span className="text-gray-500">Initializing connection...</span>
          )}
          {error && <div className="mt-2 text-red-500">{error}</div>}
        </div>
      </div>
    </div>
  );
}
