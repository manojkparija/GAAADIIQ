"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import MediaUpload from "@/components/media-upload";
import MediaGallery from "@/components/media-gallery";
import MediaDetailsModal from "@/components/media-details-modal";
import { VehicleMedia, MediaListResponse } from "@/types/media";

export default function MediaPage() {
  const { data: session } = useSession();
  const [media, setMedia] = useState<VehicleMedia[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMedia, setSelectedMedia] = useState<VehicleMedia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const token = (session as { accessToken?: string })?.accessToken ?? "";
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  useEffect(() => {
    fetchMedia();
  }, [token]);

  async function fetchMedia() {
    if (!token) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${apiUrl}/media_admin/media?page_size=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed to fetch media: ${res.status}`);
      const data: MediaListResponse = await res.json();
      setMedia(data.items);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load media";
      setError(message);
      console.error("Error fetching media:", err);
    } finally {
      setIsLoading(false);
    }
  }

  function handleUploadSuccess(newMedia: any) {
    setMedia((prev) => [newMedia, ...prev]);
    setShowUpload(false);
  }

  function handleUploadError(err: string) {
    setError(err);
  }

  const mlEnabledCount = media.filter(
    (m) =>
      (m.ocr_text !== null && m.ocr_text !== "") ||
      m.nsfw_score !== null ||
      m.license_plate_detected ||
      m.embedding_vector
  ).length;

  return (
    <div className="max-w-6xl space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Media Library</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage vehicle images and access WAVE 3 ML features
          </p>
        </div>
        <Button onClick={() => setShowUpload(!showUpload)}>
          {showUpload ? "✕ Close" : "+ Upload Media"}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Media" value={media.length} />
        <StatCard label="With ML Analysis" value={mlEnabledCount} />
        <StatCard
          label="NSFW Flagged"
          value={media.filter((m) => m.nsfw_score && m.nsfw_score > 0.5).length}
          variant="warning"
        />
        <StatCard
          label="License Plates"
          value={media.filter((m) => m.license_plate_detected).length}
          variant="info"
        />
      </div>

      {/* Upload Section */}
      {showUpload && (
        <div className="border rounded-lg p-6 bg-muted/30">
          <h2 className="font-semibold mb-4">Upload Media</h2>
          <MediaUpload
            token={token}
            onUploadSuccess={handleUploadSuccess}
            onUploadError={handleUploadError}
            maxSize={100}
            acceptedTypes={["image/jpeg", "image/png", "image/webp", "image/gif"]}
          />
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-xs text-destructive hover:underline mt-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* WAVE 3 Info Box */}
      <div className="border rounded-lg p-4 bg-blue-50 dark:bg-blue-900/20">
        <h3 className="font-semibold text-sm mb-2">🚀 WAVE 3 ML Features</h3>
        <ul className="text-sm space-y-1 text-muted-foreground">
          <li>
            <strong>🔤 OCR:</strong> Automatically extract text from vehicle brochures and documents
          </li>
          <li>
            <strong>🛡️ Safety Detection:</strong> Detect NSFW content and license plates automatically
          </li>
          <li>
            <strong>🎯 Semantic Search:</strong> Find images by meaning, not keywords (coming soon)
          </li>
        </ul>
        <p className="text-xs text-muted-foreground mt-2">
          ⏳ ML features are currently disabled due to server memory constraints. They will be available on upgraded instances.
        </p>
      </div>

      {/* Media Gallery */}
      <div className="space-y-4">
        <h2 className="font-semibold text-lg">
          Media Gallery {media.length > 0 && <span className="text-sm text-muted-foreground">({media.length})</span>}
        </h2>
        <MediaGallery media={media} isLoading={isLoading} onMediaClick={setSelectedMedia} />
      </div>

      {/* Details Modal */}
      <MediaDetailsModal media={selectedMedia} onClose={() => setSelectedMedia(null)} />
    </div>
  );
}

function StatCard({
  label,
  value,
  variant = "default",
}: {
  label: string;
  value: number;
  variant?: "default" | "warning" | "info";
}) {
  const bgColor =
    variant === "warning"
      ? "bg-amber-50 dark:bg-amber-900/20"
      : variant === "info"
        ? "bg-blue-50 dark:bg-blue-900/20"
        : "bg-muted";

  return (
    <div className={`rounded-lg border p-4 ${bgColor}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
