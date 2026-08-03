"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { MediaUploadResponse } from "@/types/media";

interface MediaUploadProps {
  token?: string;
  onUploadSuccess?: (media: MediaUploadResponse) => void;
  onUploadError?: (error: string) => void;
  maxSize?: number; // in MB
  acceptedTypes?: string[];
}

export default function MediaUpload({
  token,
  onUploadSuccess,
  onUploadError,
  maxSize = 100,
  acceptedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"],
}: MediaUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<MediaUploadResponse[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  };

  async function handleFiles(files: FileList) {
    setError(null);
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      // Validate file type
      if (!acceptedTypes.includes(file.type)) {
        setError(`Invalid file type: ${file.type}. Accepted types: ${acceptedTypes.join(", ")}`);
        onUploadError?.(`Invalid file type: ${file.type}`);
        continue;
      }

      // Validate file size
      const fileSizeMB = file.size / (1024 * 1024);
      if (fileSizeMB > maxSize) {
        setError(`File too large: ${fileSizeMB.toFixed(1)}MB exceeds ${maxSize}MB limit`);
        onUploadError?.(`File too large: ${fileSizeMB.toFixed(1)}MB`);
        continue;
      }

      await uploadFile(file);
    }
  }

  async function uploadFile(file: File) {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${apiUrl}/upload`, {
        method: "POST",
        headers,
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Upload failed: ${res.status}`);
      }

      const media: MediaUploadResponse = await res.json();
      setUploadedFiles((prev) => [...prev, media]);
      onUploadSuccess?.(media);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
      onUploadError?.(message);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Upload Zone */}
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50"
        }`}
      >
        <div className="space-y-2">
          <div className="text-3xl">📸</div>
          <h3 className="font-medium">Drag & drop media here</h3>
          <p className="text-sm text-muted-foreground">
            or click to browse (max {maxSize}MB per file)
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={acceptedTypes.join(",")}
          onChange={handleFileSelect}
          className="hidden"
          disabled={isUploading}
        />
      </div>

      {/* Error Message */}
      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Uploaded Files */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">
            {uploadedFiles.length} file{uploadedFiles.length > 1 ? "s" : ""} uploaded
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {uploadedFiles.map((media) => (
              <MediaPreview key={media.id} media={media} />
            ))}
          </div>
        </div>
      )}

      {/* Upload Button */}
      <Button
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        className="w-full"
      >
        {isUploading ? "Uploading..." : "Add Media"}
      </Button>
    </div>
  );
}

function MediaPreview({ media }: { media: MediaUploadResponse }) {
  return (
    <div className="rounded-lg border overflow-hidden bg-card">
      {media.webp_url && (
        <img
          src={media.webp_url}
          alt="uploaded"
          className="w-full h-32 object-cover"
        />
      )}
      <div className="p-3 space-y-1">
        <p className="text-sm font-medium truncate">{media.storage_key.split("/").pop()}</p>
        <p className="text-xs text-muted-foreground">
          {(media.file_size / 1024 / 1024).toFixed(1)}MB
        </p>
        {media.webp_url && (
          <a
            href={media.webp_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline block"
          >
            View
          </a>
        )}
      </div>
    </div>
  );
}
