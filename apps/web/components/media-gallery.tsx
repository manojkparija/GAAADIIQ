"use client";

import { VehicleMedia } from "@/types/media";
import { Badge } from "@/components/ui/badge";

interface MediaGalleryProps {
  media: VehicleMedia[];
  isLoading?: boolean;
  onMediaClick?: (media: VehicleMedia) => void;
}

export default function MediaGallery({ media, isLoading = false, onMediaClick }: MediaGalleryProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="rounded-lg border bg-muted animate-pulse aspect-square" />
        ))}
      </div>
    );
  }

  if (media.length === 0) {
    return (
      <div className="rounded-lg border p-12 text-center text-muted-foreground">
        <p className="text-lg">No media uploaded yet</p>
        <p className="text-sm mt-1">Upload images to get started with WAVE 3 features</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {media.map((item) => (
        <MediaCard key={item.id} media={item} onClick={() => onMediaClick?.(item)} />
      ))}
    </div>
  );
}

function MediaCard({ media, onClick }: { media: VehicleMedia; onClick: () => void }) {
  const hasOCR = media.ocr_text && media.ocr_text.length > 0;
  const hasSafety = media.nsfw_score !== null || media.license_plate_detected;
  const isFlaggedNSFW = media.nsfw_score && media.nsfw_score > 0.5;

  return (
    <div
      onClick={onClick}
      className="rounded-lg border overflow-hidden bg-card hover:border-primary transition-all cursor-pointer group"
    >
      {/* Image */}
      <div className="relative overflow-hidden bg-muted aspect-square">
        {media.webp_url ? (
          <img
            src={media.webp_url}
            alt="media"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-3xl">📄</div>
        )}

        {/* Safety Flag Overlay */}
        {isFlaggedNSFW && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="text-white text-sm font-semibold">⚠️ NSFW Flagged</span>
          </div>
        )}

        {media.license_plate_detected && (
          <div className="absolute top-2 right-2 bg-red-500/90 text-white px-2 py-1 rounded text-xs font-medium">
            🚗 Plate
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="p-3 space-y-2">
        {/* Filename */}
        <p className="text-sm font-medium truncate">{media.storage_key.split("/").pop()}</p>

        {/* Badges */}
        <div className="flex flex-wrap gap-1">
          {hasOCR && <Badge variant="secondary" className="text-xs">🔤 OCR</Badge>}
          {hasSafety && (
            <Badge variant={isFlaggedNSFW ? "destructive" : "secondary"} className="text-xs">
              {isFlaggedNSFW ? "⚠️ NSFW" : "✓ Safe"}
            </Badge>
          )}
          {media.embedding_vector && <Badge variant="secondary" className="text-xs">🎯 Embed</Badge>}
        </div>

        {/* ML Metadata */}
        {(hasOCR || hasSafety) && (
          <div className="text-xs space-y-1 text-muted-foreground">
            {hasOCR && (
              <p className="truncate" title={media.ocr_text || ""}>
                OCR: {media.ocr_text?.substring(0, 40)}...
              </p>
            )}
            {media.nsfw_score !== null && media.nsfw_score !== undefined && (
              <p>NSFW Score: {(media.nsfw_score * 100).toFixed(0)}%</p>
            )}
            {media.ocr_confidence !== null && media.ocr_confidence !== undefined && (
              <p>OCR Confidence: {(media.ocr_confidence * 100).toFixed(0)}%</p>
            )}
          </div>
        )}

        {/* Size */}
        <p className="text-xs text-muted-foreground">
          {(media.file_size / 1024 / 1024).toFixed(1)}MB
        </p>
      </div>
    </div>
  );
}
