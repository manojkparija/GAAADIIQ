export interface VehicleMediaML {
  embedding_vector?: number[] | null;
  ocr_text?: string | null;
  ocr_confidence?: number | null;
  ocr_entities?: Record<string, unknown> | null;
  nsfw_score?: number | null;
  license_plate_detected?: boolean | null;
  license_plate_bbox?: {
    x: number;
    y: number;
    w: number;
    h: number;
  } | null;
  safety_metadata?: Record<string, unknown> | null;
}

export interface VehicleMedia extends VehicleMediaML {
  id: string;
  vehicle_id?: string;
  listing_id?: string;
  storage_key: string;
  file_size: number;
  mime_type: string;
  width?: number;
  height?: number;
  duration_seconds?: number;
  thumbnail_url?: string;
  webp_url?: string;
  is_primary?: boolean;
  display_order?: number;
  exif_data?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MediaUploadResponse extends VehicleMedia {
  public_url: string;
}

export interface MediaListResponse {
  items: VehicleMedia[];
  total: number;
  page: number;
  page_size: number;
}
