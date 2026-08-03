"use client";

import { VehicleMedia } from "@/types/media";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface MediaDetailsModalProps {
  media: VehicleMedia | null;
  onClose: () => void;
}

export default function MediaDetailsModal({ media, onClose }: MediaDetailsModalProps) {
  if (!media) return null;

  const isFlaggedNSFW = media.nsfw_score && media.nsfw_score > 0.5;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-background">
          <h2 className="text-xl font-bold">Media Details</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Image Preview */}
          {media.webp_url && (
            <div className="space-y-2">
              <h3 className="font-semibold">Preview</h3>
              <img
                src={media.webp_url}
                alt="media"
                className="w-full rounded-lg border max-h-96 object-contain"
              />
            </div>
          )}

          {/* Basic Info */}
          <div className="space-y-2">
            <h3 className="font-semibold">File Information</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <InfoRow label="ID" value={media.id} />
              <InfoRow
                label="Size"
                value={`${(media.file_size / 1024 / 1024).toFixed(1)}MB`}
              />
              <InfoRow label="Type" value={media.mime_type} />
              <InfoRow
                label="Uploaded"
                value={new Date(media.created_at).toLocaleDateString()}
              />
              {media.width && media.height && (
                <InfoRow label="Dimensions" value={`${media.width}×${media.height}px`} />
              )}
            </div>
          </div>

          {/* WAVE 3 ML Features */}
          <div className="space-y-4">
            <h3 className="font-semibold">WAVE 3 ML Features</h3>

            {/* OCR Results */}
            {media.ocr_text !== null ? (
              <div className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-sm flex items-center gap-2">
                    🔤 Optical Character Recognition (OCR)
                  </h4>
                  {media.ocr_confidence !== null && media.ocr_confidence !== undefined && (
                    <Badge variant="secondary">
                      {(media.ocr_confidence * 100).toFixed(0)}% confidence
                    </Badge>
                  )}
                </div>

                {media.ocr_text && media.ocr_text.length > 0 ? (
                  <div className="bg-muted p-3 rounded text-sm max-h-48 overflow-y-auto font-mono text-xs">
                    {media.ocr_text}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No text detected</p>
                )}

                {media.ocr_entities && Object.keys(media.ocr_entities).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Extracted Entities:</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(media.ocr_entities).map(([key, value]) => (
                        <Badge key={key} variant="outline" className="text-xs">
                          {key}: {String(value)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="border rounded-lg p-4 text-sm text-muted-foreground">
                ⏳ OCR analysis not yet available (feature disabled due to memory constraints)
              </div>
            )}

            {/* Safety Detection */}
            {media.nsfw_score !== null || media.license_plate_detected ? (
              <div className="border rounded-lg p-4 space-y-3">
                <h4 className="font-medium text-sm flex items-center gap-2">
                  🛡️ Safety Detection
                </h4>

                {/* NSFW Score */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>NSFW Content Score</span>
                    <span className="font-semibold">
                      {media.nsfw_score
                        ? `${(media.nsfw_score * 100).toFixed(1)}%`
                        : "N/A"}
                    </span>
                  </div>
                  {media.nsfw_score !== null && media.nsfw_score !== undefined && (
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          isFlaggedNSFW ? "bg-destructive" : "bg-green-500"
                        }`}
                        style={{ width: `${Math.min(media.nsfw_score * 100, 100)}%` }}
                      />
                    </div>
                  )}
                  {isFlaggedNSFW && (
                    <p className="text-xs text-destructive font-medium">
                      ⚠️ Content flagged as potentially inappropriate
                    </p>
                  )}
                </div>

                {/* License Plate Detection */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>License Plate Detected</span>
                    <Badge variant={media.license_plate_detected ? "destructive" : "default"}>
                      {media.license_plate_detected ? "✓ Yes" : "✗ No"}
                    </Badge>
                  </div>
                  {media.license_plate_detected && media.license_plate_bbox && (
                    <p className="text-xs text-muted-foreground">
                      Position: ({media.license_plate_bbox.x}, {media.license_plate_bbox.y})
                      {" "}
                      Size: {media.license_plate_bbox.w}×{media.license_plate_bbox.h}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="border rounded-lg p-4 text-sm text-muted-foreground">
                ⏳ Safety detection not yet available (feature disabled due to memory constraints)
              </div>
            )}

            {/* Embeddings */}
            {media.embedding_vector ? (
              <div className="border rounded-lg p-4 space-y-2">
                <h4 className="font-medium text-sm flex items-center gap-2">
                  🎯 CLIP Embeddings
                </h4>
                <p className="text-xs text-muted-foreground">
                  Vector embedding generated for semantic search ({media.embedding_vector.length} dimensions)
                </p>
                <div className="bg-muted p-2 rounded text-xs max-h-20 overflow-y-auto font-mono">
                  [{media.embedding_vector.slice(0, 5).map(v => v.toFixed(3)).join(", ")}...]
                </div>
              </div>
            ) : (
              <div className="border rounded-lg p-4 text-sm text-muted-foreground">
                ⏳ CLIP embeddings not yet available (feature disabled due to memory constraints)
              </div>
            )}
          </div>

          {/* Safe to Use Indicator */}
          <div className="border rounded-lg p-4 bg-muted/30">
            <p className="text-sm">
              {isFlaggedNSFW ? (
                <>
                  <span className="font-semibold text-destructive">⚠️ Review Recommended</span>
                  <br />
                  <span className="text-muted-foreground">
                    This media has been flagged for inappropriate content. Please review before
                    using in listings.
                  </span>
                </>
              ) : (
                <>
                  <span className="font-semibold text-green-600">✓ Safe to Use</span>
                  <br />
                  <span className="text-muted-foreground">
                    This media passed safety checks and can be used in listings.
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t p-6 flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Close
          </Button>
          {media.webp_url && (
            <a
              href={media.webp_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1"
            >
              <Button className="w-full">Download</Button>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium truncate" title={value}>
        {value}
      </p>
    </div>
  );
}
