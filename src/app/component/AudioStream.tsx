import React, { useEffect, useRef } from "react";

interface AudioStreamProps {
  stream: MediaStream | null;
}

const AudioStream: React.FC<AudioStreamProps> = ({ stream }) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let mounted = true;

    if (audioRef.current && stream) {
      audioRef.current.srcObject = stream;
      audioRef.current.addEventListener("loadedmetadata", () => {
        if (mounted && audioRef.current) {
          audioRef.current.play().catch((error) => {
            console.error("Error playing audio:", error);
          });
        }
      });
    }

    // Cleanup when stream changes or component unmounts
    return () => {
      mounted = false;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.srcObject = null;
      }
    };
  }, [stream]);

  return <audio ref={audioRef} controls />;
};

export default AudioStream;
