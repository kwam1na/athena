import { useRef, useState, useCallback } from "react";
import { Upload, Loader2, CheckCircle2, Trash2, X } from "lucide-react";
import { Button } from "../ui/button";
import { LoadingButton } from "../ui/loading-button";
import { toast } from "sonner";
import { useAction } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { cn } from "~/src/lib/utils";

type UploadState =
  | "idle"
  | "selected"
  | "uploading"
  | "processing"
  | "ready"
  | "error";

export const ReelUploader = () => {
  const { activeStore } = useGetActiveStore();

  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getDirectUploadUrl = useAction(
    api.cloudflare.stream.getDirectUploadUrl
  );
  const getVideoStatus = useAction(api.cloudflare.stream.getVideoStatus);
  const addStreamReelVersion = useAction(
    api.cloudflare.stream.addStreamReelVersion
  );

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const validateFile = (file: File): boolean => {
    const validTypes = [
      "video/mp4",
      "video/quicktime",
      "video/webm",
      "video/x-m4v",
    ];
    if (!validTypes.includes(file.type)) {
      toast.error("Please select a video file (.mp4, .mov, .webm)");
      return false;
    }

    // 500MB limit
    if (file.size > 500 * 1024 * 1024) {
      toast.error("Video size must be less than 500MB");
      return false;
    }

    return true;
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!validateFile(file)) return;

    setSelectedFile(file);
    setUploadState("selected");
    setError(null);
  };

  const cleanup = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    cleanup();
    setSelectedFile(null);
    setUploadState("idle");
    setProgress("");
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [cleanup]);

  const pollForReady = useCallback(
    (streamUid: string) => {
      setUploadState("processing");
      setProgress("Cloudflare is transcoding your video...");

      pollIntervalRef.current = setInterval(async () => {
        try {
          const status = await getVideoStatus({ streamUid });

          if (status.readyToStream && status.playback) {
            cleanup();
            setUploadState("ready");
            setProgress("Video ready!");

            // Add as new reel version
            if (activeStore) {
              await addStreamReelVersion({
                storeId: activeStore._id,
                streamUid,
                hlsUrl: status.playback.hls,
                thumbnailUrl: status.thumbnail,
              });
              toast.success("New reel version added!");
              reset();
            }
          } else if (status.status?.pctComplete) {
            setProgress(
              `Transcoding: ${status.status.pctComplete}% complete...`
            );
          }
        } catch (err) {
          console.error("Polling error:", err);
          // Don't stop polling on transient errors
        }
      }, 5000);
    },
    [activeStore, getVideoStatus, addStreamReelVersion, cleanup, reset]
  );

  const handleUpload = async () => {
    if (!selectedFile || !activeStore) return;

    try {
      setUploadState("uploading");
      setProgress("Getting upload URL...");

      // Get direct upload URL from Cloudflare
      const { uploadUrl, streamUid } = await getDirectUploadUrl({
        maxDurationSeconds: 300,
      });

      setProgress("Uploading video...");

      // Upload directly to Cloudflare
      const formData = new FormData();
      formData.append("file", selectedFile);

      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.statusText}`);
      }

      // Start polling for transcoding completion
      pollForReady(streamUid);
    } catch (err) {
      console.error("Upload error:", err);
      setUploadState("error");
      setError((err as Error).message);
      toast.error("Failed to upload video");
    }
  };

  const stateIcon = {
    idle: null,
    selected: null,
    uploading: <Loader2 className="h-4 w-4 animate-spin" />,
    processing: <Loader2 className="h-4 w-4 animate-spin" />,
    ready: <CheckCircle2 className="h-4 w-4 text-green-500" />,
    error: null,
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">Upload new reel</p>
        <p className="text-xs text-muted-foreground">
          Upload a video file and it will be automatically transcoded for the
          storefront
        </p>
      </div>

      {/* Drop zone / file selector */}
      {uploadState === "idle" && (
        <button
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "w-full border-2 border-dashed rounded-lg p-8",
            "flex flex-col items-center justify-center gap-2",
            "text-muted-foreground hover:text-foreground hover:border-foreground/30",
            "transition-colors cursor-pointer"
          )}
        >
          <Upload className="h-8 w-8" />
          <p className="text-sm font-medium">Click to select video</p>
          <p className="text-xs">.mp4, .mov, .webm (max 500MB)</p>
        </button>
      )}

      {/* Selected file info */}
      {selectedFile && uploadState === "selected" && (
        <div className="flex items-center justify-between border rounded-lg p-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{selectedFile.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(selectedFile.size)}
            </p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <LoadingButton
              onClick={handleUpload}
              isLoading={false}
              size="sm"
              className="flex items-center gap-2"
            >
              <Upload className="h-4 w-4" />
              Upload
            </LoadingButton>
            <Button variant="ghost" size="sm" onClick={reset}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Progress state */}
      {(uploadState === "uploading" || uploadState === "processing") && (
        <div className="flex items-center gap-3 border rounded-lg p-4">
          {stateIcon[uploadState]}
          <div className="flex-1">
            <p className="text-sm font-medium">
              {selectedFile?.name}
            </p>
            <p className="text-xs text-muted-foreground">{progress}</p>
          </div>
          {uploadState === "processing" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              title="Cancel"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {/* Error state */}
      {uploadState === "error" && (
        <div className="flex items-center justify-between border border-destructive/50 rounded-lg p-4">
          <div>
            <p className="text-sm font-medium text-destructive">Upload failed</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={reset}>
            Try again
          </Button>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
};
