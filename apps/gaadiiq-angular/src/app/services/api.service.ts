import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, catchError } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  /** API root — used by the offline queue to rebuild a request URL. */
  get baseUrl(): string { return this.base; }

  getCars(): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/cars`).pipe(catchError(() => of([])));
  }
  getCarById(id: string | number): Observable<any> {
    return this.http.get<any>(`${this.base}/cars/${id}`).pipe(catchError(() => of(null)));
  }
  searchCars(query: string): Observable<any[]> {
    const params = new HttpParams().set('q', query);
    return this.http.get<any[]>(`${this.base}/cars/search`, { params }).pipe(catchError(() => of([])));
  }
  getListings(filters: Record<string, any> = {}): Observable<any[]> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params = params.set(k, String(v)); });
    return this.http.get<any[]>(`${this.base}/listings`, { params }).pipe(catchError(() => of([])));
  }
  createListing(data: any): Observable<any> {
    return this.http.post<any>(`${this.base}/listings`, data).pipe(catchError(() => of(null)));
  }
  login(email: string, password: string): Observable<any> {
    return this.http.post<any>(`${this.base}/auth/login`, { email, password }).pipe(catchError(() => of(null)));
  }
  register(data: any): Observable<any> {
    return this.http.post<any>(`${this.base}/auth/register`, data).pipe(catchError(() => of(null)));
  }
  valuateListing(listingId: string): Observable<any> {
    return this.http.post<any>(`${this.base}/listings/${listingId}/valuate`, {}).pipe(catchError(() => of(null)));
  }
  submitLoanInquiry(data: any): Observable<any> {
    return this.http.post<any>(`${this.base}/loans/inquiries`, data).pipe(catchError(() => of(null)));
  }
  getNotifications(): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/notifications`).pipe(catchError(() => of([])));
  }

  uploadDiagnosisImage(file: File) {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<{ url: string; filename: string; size_bytes: number }>(
      `${this.base}/upload/image`, form
    ).pipe(catchError(() => of(null as any)));
  }

  /** Upload an audio recording of the fault (TC-F-12). */
  uploadDiagnosisAudio(file: File) {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<{ url: string; filename: string; size_bytes: number }>(
      `${this.base}/upload/audio`, form
    ).pipe(catchError(() => of(null as any)));
  }

  /** Upload a short video of the fault (TC-F-13). */
  uploadDiagnosisVideo(file: File) {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<{ url: string; filename: string; size_bytes: number }>(
      `${this.base}/upload/video`, form
    ).pipe(catchError(() => of(null as any)));
  }

  getRecommendations(payload: {
    budget?: string; fuel?: string; body?: string; usage?: string; page_size?: number;
  }) {
    return this.http.post<any>(`${this.base}/recommend`, payload)
      .pipe(catchError(() => of(null)));
  }
}
