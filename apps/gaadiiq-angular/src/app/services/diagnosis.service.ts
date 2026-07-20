import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface PossibleCause {
  cause: string;
  confidence: number;
  explanation: string;
}

export interface DiagnosisReport {
  id: string;
  preliminary_diagnosis: string;
  possible_causes: PossibleCause[];
  repair_complexity: string;
  cost_min_inr: number;
  cost_max_inr: number;
  repair_time_estimate: string;
  safe_to_drive: boolean;
  risk_level: string;
  recommended_steps: string[];
  diy_fixes: string[];
  immediate_service_required: boolean;
  preventive_maintenance: string[];
  retrieved_sources: string[];
  ollama_used: boolean;
  analysis_confidence: number;
  disclaimer: string;
  created_at: string;
}

export interface DiagnoseRequest {
  manufacturer: string;
  model: string;
  variant?: string;
  model_year: number;
  fuel_type: string;
  transmission: string;
  odometer_km?: number;
  problem_description: string;
  warning_lights: string[];
  when_occurs: string[];
  severity: string;
  image_urls?: string[];
  user_id?: string;
}

@Injectable({ providedIn: 'root' })
export class DiagnosisService {
  private readonly api = `${environment.apiUrl}/diagnosis`;

  loading = signal(false);
  error = signal<string | null>(null);
  report = signal<DiagnosisReport | null>(null);

  constructor(private http: HttpClient) {}

  async analyse(request: DiagnoseRequest): Promise<DiagnosisReport | null> {
    this.loading.set(true);
    this.error.set(null);
    this.report.set(null);
    try {
      const result = await this.http
        .post<DiagnosisReport>(`${this.api}/analyse`, request)
        .toPromise();
      this.report.set(result ?? null);
      return result ?? null;
    } catch (e: any) {
      this.error.set(e?.error?.detail ?? 'Analysis failed. Please try again.');
      return null;
    } finally {
      this.loading.set(false);
    }
  }

  riskColor(level: string): string {
    return { Low: '#10B981', Medium: '#F59E0B', High: '#EF4444', Critical: '#7C3AED' }[level] ?? '#6B7280';
  }

  riskBg(level: string): string {
    return { Low: 'rgba(16,185,129,0.12)', Medium: 'rgba(245,158,11,0.12)', High: 'rgba(239,68,68,0.12)', Critical: 'rgba(124,58,237,0.12)' }[level] ?? 'rgba(107,114,128,0.12)';
  }

  complexityColor(c: string): string {
    return { Simple: '#10B981', Moderate: '#3B82F6', Complex: '#F59E0B', Major: '#EF4444' }[c] ?? '#6B7280';
  }

  confidenceLabel(score: number): string {
    if (score >= 80) return 'High Confidence';
    if (score >= 60) return 'Moderate Confidence';
    if (score >= 40) return 'Low Confidence';
    return 'Uncertain';
  }
}
